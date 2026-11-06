"""End-to-end browser test: clicks the real UI, finishes orders and checks the PDF.

Covers: +/- steppers (full size on mobile), typed quantities, search, kits, display stands,
optional customer data + payment terms, PDF content, local persistence, editing, deleting,
claude.ai cloud mode (mocked) and GitHub online storage (mocked API).

Usage: python3 tests/e2e_test.py  (needs: pip install playwright; Chrome/Chromium; pdftotext)
"""
import http.server, threading, functools, os, subprocess, re, json, base64
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


def cents(text):
    return int(re.sub(r'[^0-9]', '', text))


def brl(c):
    return 'R$ ' + f'{c/100:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


def plus(page, key, times=1):
    for _ in range(times):
        page.locator(f'.stepper[data-key="{key}"] button.plus').first.click()


def minus(page, key, times=1):
    for _ in range(times):
        page.locator(f'.stepper[data-key="{key}"] button.minus').first.click()


def check_steppers_fit(page):
    """Every visible stepper must be fully inside its card and 44px tall (easy to tap)."""
    bad = page.evaluate('''() => {
      const out = [];
      document.querySelectorAll('.card').forEach((card) => {
        const c = card.getBoundingClientRect();
        card.querySelectorAll('.stepper').forEach((s) => {
          const r = s.getBoundingClientRect();
          s.querySelectorAll('button').forEach((b) => {
            const br = b.getBoundingClientRect();
            if (br.height < 44 || br.width < 44) out.push('small ' + card.dataset.item);
          });
          if (r.right > c.right - 1 || r.left < c.left || r.right > window.innerWidth) out.push('clipped ' + card.dataset.item + ' ' + r.right + '>' + c.right);
        });
        const inp = card.querySelector('.stepper input');
        if (inp) {
          const bg = getComputedStyle(inp).backgroundColor;
          if (bg !== 'rgb(255, 255, 255)') out.push('input bg ' + bg);
        }
      });
      return out.slice(0, 5);
    }''')
    assert not bad, bad


def finish_and_get_pdf(page):
    page.click('#btn-finish')
    page.wait_for_selector('#done:not([hidden])')
    with page.expect_download() as dl:
        page.click('#btn-done-download')
    path = os.path.join('/tmp', dl.value.suggested_filename)
    dl.value.save_as(path)
    return path, subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout


def local_mode(browser, url, errors):
    ctx = browser.new_context(accept_downloads=True, viewport={'width': 360, 'height': 780})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    assert page.locator('.card').count() == 147
    check_steppers_fit(page)

    plus(page, 'product:alecrim|30 g', 3)
    minus(page, 'product:alecrim|30 g', 1)                     # 2 x 33,75
    inp = page.locator('.stepper[data-key="product:chimichurri-defumado|100 g"] input')
    inp.fill('4'); inp.press('Enter')                          # 4 x 274,50
    page.fill('#search', 'parrilha'); page.wait_for_timeout(300)
    assert page.locator('.card').count() == 1
    plus(page, 'product:sal-de-parrilha|250 g')                # 1 x 111,00
    page.fill('#search', ''); page.wait_for_timeout(300)

    page.click('#tab-kits')
    assert page.locator('.card').count() == 12
    check_steppers_fit(page)
    plus(page, 'kit:kit-peixaria|100 g', 2)                    # 2 x 1.056,00

    page.click('#tab-displays')
    assert page.locator('.card').count() == 12
    check_steppers_fit(page)
    plus(page, 'display:expositor-gondola-1m|un', 2)
    plus(page, 'display:display-balcao-pequeno|un')
    page.locator('.chip', has_text='Gôndola').click()
    assert page.locator('.card').count() == 4

    expected = 2 * 3375 + 4 * 27450 + 11100 + 2 * 105600
    assert cents(page.inner_text('#bar-total')) == expected, page.inner_text('#bar-total')
    assert page.inner_text('#bar-fardos') == str(2 + 4 + 1 + 16)

    page.click('#tab-selected')
    assert page.locator('.card').count() == 6
    check_steppers_fit(page)

    page.click('#btn-review')
    assert page.locator('.rline').count() == 6
    page.locator('.rline', has_text='Sal de Parrilha').locator('.remove').click()
    expected -= 11100
    page.locator('#review-lines .stepper[data-key="product:alecrim|30 g"] button.plus').click()
    expected += 3375
    assert cents(page.inner_text('#review-totals .grand')) == expected
    assert 'Expositores' in page.inner_text('#review-totals')

    # No field is mandatory: finish with an empty form first
    path, text = finish_and_get_pdf(page)
    assert brl(expected) in text, text
    assert 'A combinar' in text
    page.keyboard.press('Escape')

    # Then fill customer + payment data and save the same order again
    page.click('#btn-review')
    page.fill('[name=store]', 'Mercado São João')
    page.fill('[name=doc]', '12.345.678/0001-90')
    page.fill('[name=phone]', '(41) 99999-0000')
    page.fill('[name=address]', 'Rua XV de Novembro, 100 - Curitiba/PR')
    page.check('[name=addressConfirmed]')
    page.select_option('[name=paymentMethod]', 'Boleto')
    page.select_option('[name=paymentTerm]', '14/21/28 dias')
    page.fill('[name=notes]', 'Entregar pela manhã.')
    path, text = finish_and_get_pdf(page)
    for needle in ['Mercado São João', '12.345.678/0001-90', '(41) 99999-0000', 'Rua XV de Novembro',
                   '(confirmado)', 'Boleto · 14/21/28 dias', 'Entregar pela manhã.', 'Alecrim', 'Chimichurri Defumado',
                   'Kit Peixaria', 'Expositor de gôndola 1 m', 'Display de balcão pequeno', 'Expositores (sem valor):', brl(expected)]:
        assert needle in text, (needle, text)
    assert 'Sal de Parrilha' not in text
    assert page.inner_text('#history-count') == '1'            # same order updated, not duplicated
    page.keyboard.press('Escape')

    # Persistence after reload
    page.reload()
    assert page.inner_text('#history-count') == '1'
    assert cents(page.inner_text('#bar-total')) == expected
    page.click('#btn-history')
    assert cents(page.locator('.hline .htop span').nth(1).inner_text()) == expected
    assert 'Boleto 14/21/28 dias' in page.inner_text('.hline .hmeta')

    # Delete: cancel keeps, confirm removes
    page.locator('.hline [data-h=del]').click(); page.click('#confirm-cancel')
    assert page.locator('.hline').count() == 1
    page.locator('.hline [data-h=del]').click(); page.click('#confirm-ok')
    assert page.locator('.hline').count() == 0
    page.keyboard.press('Escape')
    page.evaluate("document.getElementById('btn-new-order').click()")
    assert cents(page.inner_text('#bar-total')) == 0
    page.screenshot(path='/tmp/e2e-mobile.png')
    ctx.close()
    print('Local mode OK, total', brl(expected), path)


CLAUDE_MOCK = r'''
(() => {
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


def claude_mode(browser, url, errors):
    ctx = browser.new_context(viewport={'width': 400, 'height': 860})
    ctx.add_init_script(CLAUDE_MOCK)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function('window.CDTApp.Remote.ready === true')
    plus(page, 'product:curry|50 g', 2)
    page.click('#btn-review')
    page.fill('[name=store]', 'Empório Cloud')
    page.click('#btn-finish')
    page.click('#btn-done-download')
    page.wait_for_function('window.__saved.length === 1')
    assert page.evaluate('window.__saved')[0]['filename'].endswith('.pdf')
    page.wait_for_timeout(1500)
    mockdb = page.evaluate("localStorage.getItem('__mockdb')")
    assert page.is_hidden('#gh-box')                           # GitHub option hidden inside claude.ai
    ctx.close()

    ctx2 = browser.new_context(viewport={'width': 400, 'height': 860})
    ctx2.add_init_script(f"localStorage.setItem('__mockdb', {json.dumps(mockdb)});")
    ctx2.add_init_script(CLAUDE_MOCK)
    page = ctx2.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("document.getElementById('history-count').textContent === '1'")
    assert cents(page.inner_text('#bar-total')) == 2 * 5925
    ctx2.close()
    print('Claude cloud mode OK')


def github_mode(browser, url, errors):
    """Mock api.github.com contents API to check the online storage on GitHub Pages."""
    files = {}   # path -> (sha, text)
    calls = []

    def handle(route, request):
        calls.append((request.method, request.url))
        assert request.headers.get('authorization') == 'Bearer test-token'
        path = request.url.split('api.github.com', 1)[1].split('?')[0]
        m = re.match(r'^/repos/acme/pedidos(?:/contents/(.*))?$', path)
        if not m:
            return route.fulfill(status=404, body='{}')
        fpath = m.group(1)
        if fpath is None:
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'full_name': 'acme/pedidos', 'private': True}))
        if request.method == 'GET' and fpath == 'pedidos':
            lst = [{'type': 'file', 'name': p.split('/')[-1], 'path': p, 'sha': s} for p, (s, _) in files.items()]
            return route.fulfill(status=200 if lst else 404, content_type='application/json', body=json.dumps(lst))
        if request.method == 'GET':
            if fpath not in files:
                return route.fulfill(status=404, body='{}')
            sha, text = files[fpath]
            if 'raw' in (request.headers.get('accept') or ''):
                return route.fulfill(status=200, content_type='application/json', body=text)
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'sha': sha}))
        if request.method == 'PUT':
            body = json.loads(request.post_data)
            if fpath in files and body.get('sha') != files[fpath][0]:
                return route.fulfill(status=409, body='{"message":"sha mismatch"}')
            sha = 'sha%d' % len(calls)
            files[fpath] = (sha, base64.b64decode(body['content']).decode('utf-8'))
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'content': {'sha': sha}}))
        if request.method == 'DELETE':
            files.pop(fpath, None)
            return route.fulfill(status=200, body='{}')
        return route.fulfill(status=405, body='{}')

    ctx = browser.new_context(viewport={'width': 400, 'height': 860})
    ctx.route('https://api.github.com/**', handle)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    page.click('#btn-history')
    page.click('#gh-box summary')
    page.fill('#gh-repo', 'acme/pedidos')
    page.fill('#gh-token', 'test-token')
    page.click('#gh-connect')
    page.wait_for_function('window.CDTApp.Remote.kind === "github" && window.CDTApp.Remote.ready')
    assert 'GitHub (acme/pedidos)' in page.inner_text('#storage-label')
    page.keyboard.press('Escape')
    plus(page, 'product:tomilho|30 g', 3)
    page.click('#btn-review')
    page.fill('[name=store]', 'Loja Online')
    page.click('#btn-finish')
    page.wait_for_function('() => true')
    page.wait_for_timeout(800)
    assert len(files) == 1, files
    saved = json.loads(list(files.values())[0][1])
    assert saved['customer']['store'] == 'Loja Online' and saved['totalCents'] == 3 * 9225
    # edit & save again -> same file updated (sha handled)
    page.keyboard.press('Escape')
    plus(page, 'product:tomilho|30 g')
    page.click('#btn-review'); page.click('#btn-finish'); page.wait_for_timeout(800)
    assert len(files) == 1 and json.loads(list(files.values())[0][1])['totalCents'] == 4 * 9225
    ctx.close()

    # Another device: connects with the same repo and sees the order
    ctx2 = browser.new_context(viewport={'width': 400, 'height': 860})
    ctx2.route('https://api.github.com/**', handle)
    page = ctx2.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    page.click('#btn-history'); page.click('#gh-box summary')
    page.fill('#gh-repo', 'acme/pedidos'); page.fill('#gh-token', 'test-token'); page.click('#gh-connect')
    page.wait_for_function("document.getElementById('history-count').textContent === '1'")
    assert 'Loja Online' in page.inner_text('#history-list')
    # token remembered after reload, no need to type again
    page.reload()
    page.wait_for_function('window.CDTApp.Remote.kind === "github" && window.CDTApp.Remote.ready')
    page.click('#btn-history')
    page.locator('.hline [data-h=del]').click(); page.click('#confirm-ok'); page.wait_for_timeout(500)
    assert len(files) == 0
    ctx2.close()
    print('GitHub online storage OK')


def main():
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_port}/index.html'
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        local_mode(browser, url, errors)
        claude_mode(browser, url, errors)
        github_mode(browser, url, errors)
        browser.close()
    srv.shutdown()
    assert not errors, errors
    print('E2E OK')


if __name__ == '__main__':
    main()
