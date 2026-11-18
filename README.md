# CDT Atacado System

**Online:** https://andremarrocos.github.io/CDT-Atacado-System/

Sistema simples para tirar **pedidos de atacado do Clube do Tempero Lojista**, com base no catálogo *Impacto Terracota*.

- **147 produtos** e **408 variações** (30 g / 50 g / 100 g / 250 g), com os preços exatos do catálogo.
- **52 chás** (aba Chás): 39 novos tirados de clubedotempero.com/chas com preço do site − 25% × 10 pacotes, e 13 que já estavam no catálogo.
- **12 kits** (Peixaria, Açougue, Casa de Carnes, Hortifruti, Mercearia, Minimercado, Conveniência e Posto, Autoatendimento, Casa de Temperos, Loja de Produtos Naturais, Padaria, Empório).
- **12 tipos de expositor** (balcão, gôndola 60 cm / 1 m, ponta de gôndola, centro, chão, parede, clip strip) para incluir no pedido, sem valor.
- Preços em **R$ por fardo com 10 unidades**. A quantidade do pedido é em fardos.
- Dados do cliente (todos opcionais): nome/loja, CNPJ, telefone, endereço com confirmação, forma de pagamento (Pix, Boleto, Cartão) e prazo (à vista, 7 a 35 dias e parcelados), observações.

## Como usar

1. Abra https://andremarrocos.github.io/CDT-Atacado-System/ (ou o `index.html` local, que funciona offline).
2. Toque em **+** / **−** em cada gramatura, ou digite a quantidade.
3. Na revisão, escolha **Fardo** ou **Fitinha** em cada item (ou “Tudo em…”). Os dois têm 10 pacotes e o mesmo preço; PDF e separação da fábrica mostram a embalagem.
4. Use a busca e os filtros (Especiarias e Ervas, Caldos, Farinhas, Sais, Temperos) e a aba **Kits**.
4. A barra de baixo mostra o total de fardos e o **valor total** em tempo real.
5. **Revisar e finalizar** → preencha os dados do cliente, ajuste/remova itens → **Finalizar e gerar PDF**.
6. Baixe o PDF ou **compartilhe** direto (WhatsApp etc. no celular). O PDF mostra a **Quantidade** (ex.: “3 fardos”, “2 kits (16 fardos)”) e os **Pacotes** de cada linha.
7. **🏭 PDF de separação (fábrica):** lista sem preços, com os kits abertos por sabor e somados, fardos e pacotes por sabor/gramatura e caixinha para marcar na separação.
8. **📊 Análise:** total de pedidos, faturamento, ticket médio, fardos, faturamento por mês, produtos/kits e clientes que mais compram, formas de pagamento, lista de todos os pedidos e exportação em CSV (abre no Excel).

### Onde os pedidos ficam salvos
- O pedido em andamento é salvo automaticamente (não se perde ao fechar a página).
- **Online (GitHub Pages):** em *Pedidos salvos → Salvar pedidos online (GitHub)*, conecte um repositório **privado** (ex.: `CDT-Atacado-Pedidos`) com um token *fine-grained* com permissão *Contents: Read and write* só nesse repositório. Cada pedido vira `pedidos/<número>.json` lá, e aparece em qualquer aparelho conectado.
- **Online (página no claude.ai):** os pedidos ficam na sua conta automaticamente.
- Pedidos finalizados vão para **Pedidos salvos**: reabrir PDF, compartilhar, editar, duplicar ou excluir.
- Os dados ficam no navegador do aparelho (localStorage). Use **Exportar backup** para gerar um `.json` e **Importar backup** para restaurar em outro aparelho.

## Estrutura

```
index.html              Interface
css/style.css           Estilos (paleta terracota do catálogo)
js/catalog.js           Catálogo gerado a partir do PDF (não editar à mão)
js/order-core.js        Regras do pedido: somas em centavos, +/−, remover, totais
js/pdf.js               Geração do PDF (jsPDF + AutoTable)
js/expositores.js       Tipos de expositor (sem preço)
js/github-sync.js       Salvamento online opcional em repositório privado do GitHub
js/analise.js           Análise rápida dos pedidos (cálculos + tela)
js/chas.js              Chás do site (gerado por tools/build_chas.py)
data/chas-site.json     Chás e preços lidos do site
js/app.js               Controle da tela, salvamento e histórico
data/catalog.json       Mesmo catálogo em JSON
img/produtos/           Fotos dos produtos (extraídas do catálogo)
vendor/                 jsPDF 2.5.2 e jsPDF-AutoTable 3.8.4 (sem depender de CDN)
tools/build_catalog.py  Regera o catálogo a partir de um novo PDF
tests/                  Testes unitários (Node) e ponta a ponta (Playwright)
```

## Conferência dos dados

O script de geração confere **todos os 33 preços de kit** contra a soma dos produtos que compõem cada kit — todos batem centavo a centavo, o que valida a leitura dos preços individuais. Gramaturas marcadas com “-” no catálogo não aparecem para venda. Farinha de Tapioca em Flocos e os sais (Parrilha, Açafrão, Colorau, Rosa do Himalaia) são vendidos em 250 g, como no catálogo.

## Testes

```bash
npm test                       # lógica do pedido + conferência do catálogo
python3 tests/e2e_test.py      # clica na tela real, finaliza, lê o PDF e testa o salvamento
```

## Atualizar os chás

Os preços dos chás vêm do site (`data/chas-site.json`, preço por pacote em 18/11/2026). Regra: **fardo = preço do site × 0,75 × 10**. Para atualizar, troque os preços nesse arquivo e rode:

```bash
python3 tools/build_chas.py   # gera js/chas.js e mostra a comparação com o catálogo
```

As fotos dos chás novos são carregadas direto da loja (CDN da Nuvemshop); se não carregarem, aparece o logo.

## Atualizar o catálogo

```bash
mkdir -p /tmp/imgs && pdfimages -j -f 2 -l 12 NovoCatalogo.pdf /tmp/imgs/img
python3 tools/build_catalog.py NovoCatalogo.pdf
```

> Os nomes de kits/itens estão listados em `tools/build_catalog.py` e devem ser revisados se o catálogo mudar a composição dos kits.
