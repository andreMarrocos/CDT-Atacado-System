"""End-to-end browser test: clicks the real UI, finishes an order and checks the PDF.

Usage: python3 tests/e2e_test.py  (needs: pip install playwright; a Chrome/Chromium install; pdftotext)
"""
import http.server, threading, functools, os, subprocess, sys, re, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    handler = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def brl_to_cents(text):
    return int(re.sub(r'[^0-9]', '', text))


MOCK = r'''
(() => {
  // Minimal in-memory stand-in for the claude.ai artifact runtime (db, user, downloads).
  const store = JSON.parse(localStorage.getItem('__mockdb') || '{}');
  const persist = () => localStorage.setItem('__mockdb', JSON.stringify(store));
  window.__saved = [];
  const docRef = (path) => ({ id: path.split('/').pop(), path,
    get: async () => ({ id: path.split('/').pop(), exists: path in store, data: () => store[path] }),
    set: async (d) => { store[path] = JSON.parse(JSON.stringify(d)); persist(); },
    delete: async () => { delete store[path]; persist(); } });
  const db = { doc: docRef, collection: (cp) => ({ doc: (id) => docRef(cp + '/' + id),
    get: async () => { const docs = Object.keys(store).filter(k => k.startsWith(cp + '/') && k.split('/').length === cp.split('/').length + 1)
      .map(k => ({ id: k.split('/').pop(), exists: true, data: () => store[k] })); return { docs, size: docs.length, empty: !docs.length }; } }) };
  const user = { id: async () => 'u123' };
  const downloads = { save: async ({ filename, data }) => { window.__saved.push({ filename, size: data.size || data.length }); return { status: 'saved' }; } };
  window.claude = { use: async (n) => ({ db, user, downloads }[n] || null) };
})();
'''


def cloud_mode(browser, url, errors):
    # Device A creates an order; device B (fresh browser storage, same cloud) must see it.
    ctx = browser.new_context(viewport={'width': 400, 'height': 860})
    ctx.add_init_script(MOCK)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function('window.CDTApp.Cloud.ready === true')
    page.locator('.stepper[data-key="product:curry|50 g"] button.plus').click()
    page.locator('.stepper[data-key="product:curry|50 g"] button.plus').click()
    page.click('#btn-review')
    page.fill('[name=store]', 'Empório Cloud')
    page.click('#btn-finish')
    page.wait_for_function('window.__saved.length === 1')
    saved = page.evaluate('window.__saved')
    assert saved[0]['filename'].endswith('.pdf') and saved[0]['size'] > 5000, saved
    page.wait_for_timeout(1500)  # let the debounced draft write finish
    mockdb = page.evaluate("localStorage.getItem('__mockdb')")
    ctx.close()

    ctx2 = browser.new_context(viewport={'width': 400, 'height': 860})
    ctx2.add_init_script(f"localStorage.setItem('__mockdb', {json.dumps(mockdb)});")
    ctx2.add_init_script(MOCK)
    page = ctx2.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function('window.CDTApp.Cloud.ready === true')
    page.wait_for_function("document.getElementById('history-count').textContent === '1'")
    assert brl_to_cents(page.inner_text('#bar-total')) == 2 * 5925  # draft restored from cloud
    page.click('#btn-history')
    assert 'Empório Cloud' in page.inner_text('#history-list')
    assert 'conta' in page.inner_text('#storage-label')
    page.locator('.hline [data-h=del]').click()
    page.click('#confirm-ok')
    page.wait_for_timeout(300)
    left = page.evaluate("Object.keys(JSON.parse(localStorage.getItem('__mockdb'))).filter(k => k.includes('order_')).length")
    assert left == 0, left
    ctx2.close()
    print('Cloud mode OK')


def main():
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_port}/index.html'
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        ctx = browser.new_context(accept_downloads=True, viewport={'width': 400, 'height': 860})
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda d: d.accept())
        page.goto(url)

        assert page.locator('.card').count() == 147, page.locator('.card').count()

        def plus(item, size, times=1):
            for _ in range(times):
                page.locator(f'.stepper[data-key="{item}|{size}"] button.plus').first.click()

        def minus(item, size, times=1):
            for _ in range(times):
                page.locator(f'.stepper[data-key="{item}|{size}"] button.minus').first.click()

        # Alecrim 30 g x3 then -1 => 2 x 33,75
        plus('product:alecrim', '30 g', 3)
        minus('product:alecrim', '30 g', 1)
        # Chimichurri Defumado 100 g typed quantity 4 => 4 x 274,50
        inp = page.locator('.stepper[data-key="product:chimichurri-defumado|100 g"] input')
        inp.fill('4'); inp.press('Enter')
        # Search then add Sal de Parrilha 250 g x1 => 111,00
        page.fill('#search', 'parrilha'); page.wait_for_timeout(300)
        assert page.locator('.card').count() == 1
        plus('product:sal-de-parrilha', '250 g', 1)
        page.fill('#search', ''); page.wait_for_timeout(300)
        # Kit Peixaria 100 g x2 => 2 x 1.056,00, 16 fardos
        page.click('#tab-kits')
        assert page.locator('.card').count() == 12
        plus('kit:kit-peixaria', '100 g', 2)

        expected = 2 * 3375 + 4 * 27450 + 11100 + 2 * 105600
        bar = brl_to_cents(page.inner_text('#bar-total'))
        assert bar == expected, (bar, expected)
        assert page.inner_text('#bar-fardos') == str(2 + 4 + 1 + 16)

        # "No pedido" tab shows only selected items
        page.click('#tab-selected')
        assert page.locator('.card').count() == 4

        # Review drawer: remove one line, change one qty
        page.click('#btn-review')
        assert page.locator('.rline').count() == 4
        page.locator('.rline', has_text='Sal de Parrilha').locator('.remove').click()
        expected -= 11100
        page.locator('#review-lines .stepper[data-key="product:alecrim|30 g"] button.plus').click()
        expected += 3375
        grand = brl_to_cents(page.inner_text('#review-totals .grand'))
        assert grand == expected, (grand, expected)

        # Finishing without store name must be blocked
        page.click('#btn-finish')
        assert page.is_visible('#review')
        page.fill('[name=store]', 'Mercado São João')
        page.fill('[name=doc]', '12.345.678/0001-90')
        page.fill('[name=city]', 'Curitiba/PR')
        page.fill('[name=notes]', 'Entregar pela manhã.')
        with page.expect_download() as dl:
            page.click('#btn-finish')
        pdf_path = os.path.join('/tmp', dl.value.suggested_filename)
        dl.value.save_as(pdf_path)
        text = subprocess.run(['pdftotext', '-layout', pdf_path, '-'], capture_output=True, text=True).stdout
        assert 'Mercado São João' in text, text[:500]
        assert 'Alecrim' in text and 'Chimichurri Defumado' in text and 'Kit Peixaria' in text
        assert 'Sal de Parrilha' not in text
        total_txt = 'R$ ' + f'{expected/100:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
        assert total_txt in text, (total_txt, text)
        assert 'Total de fardos:' in text and ' 23' in text

        # Persistence: reload and check history + draft survive
        page.reload()
        assert page.inner_text('#history-count') == '1'
        assert brl_to_cents(page.inner_text('#bar-total')) == expected
        page.click('#btn-history')
        assert page.locator('.hline').count() == 1
        hist_total = brl_to_cents(page.locator('.hline .htop span').nth(1).inner_text())
        assert hist_total == expected

        # Editing the same order must not create a duplicate
        page.keyboard.press('Escape')
        plus('product:alecrim', '30 g', 1)
        expected += 3375
        page.click('#btn-review')
        with page.expect_download():
            page.click('#btn-finish')
        page.keyboard.press('Escape')
        assert page.inner_text('#history-count') == '1'
        page.click('#btn-history')
        assert brl_to_cents(page.locator('.hline .htop span').nth(1).inner_text()) == expected

        # Delete with the in-page confirm: cancel keeps it, confirm removes it
        page.locator('.hline [data-h=del]').click()
        page.click('#confirm-cancel')
        assert page.locator('.hline').count() == 1
        page.keyboard.press('Escape')

        # New order clears the cart, keeps history
        page.keyboard.press('Escape')
        page.evaluate("document.getElementById('btn-new-order').click()")
        assert brl_to_cents(page.inner_text('#bar-total')) == 0
        assert page.inner_text('#history-count') == '1'

        page.screenshot(path='/tmp/e2e-final.png')
        page.click('#btn-history')
        page.locator('.hline [data-h=del]').click()
        page.click('#confirm-ok')
        assert page.locator('.hline').count() == 0
        assert page.inner_text('#history-count') == '0'

        cloud_mode(browser, url, errors)
        browser.close()
    srv.shutdown()
    assert not errors, errors
    print('E2E OK - expected total', expected, 'PDF:', pdf_path)


if __name__ == '__main__':
    main()
