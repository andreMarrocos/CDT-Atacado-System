"""Rebuild data/catalog.json, js/catalog.js and img/produtos/ from the catalog PDF.

Usage:
    pdfimages -j -f 2 -l 12 Catalogo.pdf /tmp/imgs/img     # extract product photos
    python3 tools/build_catalog.py Catalogo.pdf

Requires: pdfplumber, Pillow, poppler-utils (pdfimages). Kit prices are checked against
the sum of their products, so any price-reading error makes the script report a DIFF.
"""
import pdfplumber, json, re, sys, os
RAW_JSON=None
pdf=pdfplumber.open(sys.argv[1])
products=[]
for pi in range(1,12):
    p=pdf.pages[pi]; W=p.width
    words=p.extract_words(extra_attrs=['fontname','size'],keep_blank_chars=False)
    for half in (0,1):
        ws=[w for w in words if (w['x0']<W/2)==(half==0) and 100<w['top']<800]
        hdr=[w for w in ws if w['text'] in('30','50','100') and abs(w['top']-108)<3]
        cols={w['text']:w['x0']+8 for w in hdr}
        names=[w for w in ws if 'Bold' in w['fontname'] and abs(w['size']-9.0)<0.3]
        prices=[w for w in ws if 'Bold' in w['fontname'] and abs(w['size']-8.2)<0.3]
        uso=[w for w in ws if 'Regular' in w['fontname'] and abs(w['size']-7.6)<0.3]
        cats=[w for w in ws if w['text'].isupper() and len(w['text'])>3 and w['size']<7 ]
        # group names into blocks: consecutive lines within 12pt
        names.sort(key=lambda w:(w['top'],w['x0']))
        blocks=[]
        for w in names:
            if blocks and w['top']-blocks[-1]['last']<12: 
                blocks[-1]['words'].append(w); blocks[-1]['last']=w['top']
            else: blocks.append({'top':w['top'],'last':w['top'],'words':[w]})
        for i,b in enumerate(blocks):
            end=blocks[i+1]['top'] if i+1<len(blocks) else 800
            name=' '.join(w['text'] for w in b['words'])
            u=' '.join(w['text'] for w in sorted([w for w in uso if b['top']-2<=w['top']<end],key=lambda w:(w['top'],w['x0'])))
            pr={}
            for w in [w for w in prices if b['top']-2<=w['top']<end]:
                x=w['x0']+(w['x1']-w['x0'])/2
                k=min(cols,key=lambda c:abs(cols[c]-x))
                if w['text']!='-': pr[k+'g']=w['text']
            prices_other=[w['text'] for w in ws if b['top']-2<=w['top']<end and w not in prices and w not in uso and w not in b['words'] and not w in cats]
            cat=[c['text'] for c in cats if b['top']-25<c['top']<b['top']]
            products.append(dict(page=pi+1,half=half,name=name,uso=u,prices=pr,other=prices_other,cat=cat))
print(len(products), 'products parsed')
raw=products
if False:
    print(p['page'],p['half'],p['cat'],'|',p['name'],'|',p['prices'],'|',p['other'] if p['other'] else '')

# ---- build output ----
import unicodedata
from PIL import Image
PDF=sys.argv[1]; IMGS=os.environ.get('IMGS','/tmp/imgs'); OUT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pdf=pdfplumber.open(PDF)
# image index mapping: stream order per page; files img-NNN in global order pages 2..12
files=sorted(os.listdir(IMGS)); gi=0; pageimgs={}
for pi in range(1,12):
    ims=pdf.pages[pi].images
    pageimgs[pi+1]=[]
    for im in ims:
        pageimgs[pi+1].append((im,files[gi])); gi+=1
assert gi==len(files),(gi,len(files))
def slug(s):
    s=unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+','-',s).strip('-')
def num(s): return float(s.replace('.','').replace(',','.'))
blocks_top={}
# recover block tops
for pi in range(1,12):
    p=pdf.pages[pi]; W=p.width
    for w in p.extract_words(extra_attrs=['fontname','size']):
        pass
products=[]; seen=set()
W=pdf.pages[1].width
for i,r in enumerate(raw):
    name=r['name'].replace(' - ',' - ')
    pid=slug(name)
    assert pid not in seen,pid; seen.add(pid)
    # find block top: first word of name on that page/half
    p=pdf.pages[r['page']-1]
    first=name.split()[0]
    cands=[w for w in p.extract_words(extra_attrs=['size']) if abs(w['size']-9.0)<0.3 and w['text']==first and (w['x0']<W/2)==(r['half']==0)]
    imgs=[(im,f) for im,f in pageimgs[r['page']] if im['height']>60 and (im['x0']<W/2)==(r['half']==0)]
    best=None
    for c in cands:
        for im,f in imgs:
            d=abs(im['top']-c['top'])
            if d<15 and (best is None or d<best[0]): best=(d,f)
    assert best,name
    is250='250' in r['other']
    vars_=[]
    for k in ('30g','50g','100g'):
        if k in r['prices']:
            size='250 g' if is250 else k.replace('g',' g')
            vars_.append({'size':size,'price':num(r['prices'][k])})
    n=name
    cat=('Caldos' if n.startswith('Caldo') else 'Farinhas' if n.startswith('Farinha') else 'Sais' if n.startswith('Sal ') else 'Temperos' if n.startswith('Tempero') else 'Especiarias e Ervas')
    if n in ('Beterraba em pó',): cat='Especiarias e Ervas'
    img=f'img/produtos/{pid}.jpg'
    im=Image.open(os.path.join(IMGS,best[1])).convert('RGB'); im.thumbnail((300,300)); im.save(OUT+'/'+img,quality=82,optimize=True)
    products.append({'id':pid,'code':f'{i+1:03d}','name':name,'category':cat,'use':r['uso'],'image':img,'variants':vars_})
assert len(products)==147
byname={p['name']:p for p in products}
kits_src=[
 ('Kit Peixaria',"Do balcão de pescados para a cozinha.",['Tempero para Peixe','Chimichurri Peixe','Lemon Pepper','Limão e Ervas Finas','Coentro em Pó','Pimenta Branca Moída','Açafrão Cúrcuma - Puro','Salsa Desidratada'],{'30 g':432.00,'50 g':612.75,'100 g':1056.00}),
 ('Kit Açougue',"Um tempero para cada corte.",['Tempero para Carne','Tempero para Carne Suína','Tempero para Frango','Tempero de Bife Acebolado','Alho em Pó','Pimenta do Reino Moída','Páprica Doce','Cominho em Pó'],{'30 g':378.00,'50 g':521.25,'100 g':858.00}),
 ('Kit Casa de Carnes',"Temperos para cortes e churrasco.",['Dry Rub Bovino','Dry Rub Frango','Dry Rub Defumado','Chimichurri sem Pimenta','Chimichurri Picante','Vinagrete','Alho Frito','Páprica Defumada'],{'30 g':507.00,'50 g':721.50,'100 g':1266.75}),
 ('Kit Hortifruti',"Legumes e folhas encontram seus sabores.",['Alecrim','Ervas Finas','Limão e Ervas Finas','Cheiro Verde','Salsa, Cebola e Alho','Curry','Gergelim Branco','Tomate Desidratado'],{'30 g':321.00,'50 g':436.50,'100 g':732.00}),
 ('Kit Mercearia',"Os ingredientes da cozinha de casa.",['Alho Areia','Cebola Desidratada','Colorau Extra Forte','Cominho em Pó','Pimenta do Reino Moída','Folhas de Louro Moído','Canela em Pó','Orégano'],{'30 g':387.75,'50 g':542.25}),
 ('Kit Minimercado',"Variedade para a refeição da semana.",['Tempero para Arroz','Tempero para Feijão','Tempero para Frango','Tempero para Carne','Tempero para Peixe','Tempero Completo com Ervas Finas','Lemon Pepper','Chimichurri sem Pimenta','Páprica Defumada','Manjericão'],{'30 g':556.50,'50 g':785.25,'100 g':1326.75}),
 ('Kit Conveniência e Posto',"O complemento da compra de passagem.",['Dry Rub','Chimichurri Defumado','Vinagrete','Pimenta Calabresa','Limão e Orégano','Alho Frito'],{'30 g':388.50,'50 g':553.50,'100 g':951.75}),
 ('Kit Autoatendimento',"O nome já ajuda a escolher.",['Tempero para Arroz','Tempero para Feijão com Colorau','Tempero Completo','Tempero para Frango','Tempero de Bife Acebolado','Tempero Italiano'],{'30 g':259.50,'50 g':356.25,'100 g':591.00}),
 ('Kit Casa de Temperos',"Sabores para descobrir e combinar.",['Curry','Tempero Árabe - Zaatar','Tempero Sírio Bahar','Chilli Mexicano','Mostarda em Pó','Pimenta Jamaica Moída','Noz Moscada Moída','Coentro em Grãos','Gengibre em Pó','Orange Pepper'],{'30 g':598.50,'50 g':873.00,'100 g':1504.50}),
 ('Kit Loja de Produtos Naturais',"Farinhas e ingredientes para novas receitas.",['Farinha de Banana Verde','Farinha de Batata Doce','Farinha de Linhaça Marrom','Farinha de Maçã','Farinha de Maracujá','Farinha de Uva','Beterraba em pó','Gengibre em Pó'],{'100 g':710.25}),
 ('Kit Padaria',"Do pão salgado ao bolo caseiro.",['Canela em Pó','Cravo em Pó','Erva Doce','Noz Moscada Moída','Gergelim Branco','Gergelim Preto','Alecrim','Cebola em Pó'],{'30 g':398.25,'50 g':561.00,'100 g':980.25}),
 ('Kit Empório',"Aromas e finalizações para explorar.",['Tomilho','Pimenta Rosa em Grão','Pimenta do Reino em Grão (Grãos Selecionados)','Manjericão','Pimenta Branca em Grão','Alecrim em Pó','Orange Pepper','Mostarda em Pó'],{'30 g':586.50,'50 g':852.75,'100 g':1488.75}),
]
kits=[]
for name,desc,items,prices in kits_src:
    ids=[byname[n]['id'] for n in items]
    for size,price in prices.items():
        s=0
        for n in items:
            v=[x for x in byname[n]['variants'] if x['size']==size]; assert v,(name,n,size); s+=v[0]['price']
        flag='OK' if abs(s-price)<0.001 else f'DIFF soma={s:.2f}'
        print(f'{name:32s} {size:6s} catálogo={price:9.2f} {flag}')
    kits.append({'id':slug(name),'name':name,'description':desc,'items':ids,'fardos':len(items),'variants':[{'size':k,'price':v} for k,v in prices.items()],'image':byname[items[0]]['image']})
data={'source':'Catálogo Clube do Tempero Lojista — Impacto Terracota','unit':'fardo com 10 unidades','products':products,'kits':kits}
with open(OUT+'/js/catalog.js','w') as f:
    f.write('// Auto-generated from the catalog PDF by tools/build_catalog.py. Do not edit by hand.\n')
    f.write('window.CDT_CATALOG = '+json.dumps(data,ensure_ascii=False,indent=1)+';\n')
json.dump(data,open(OUT+'/data/catalog.json','w'),ensure_ascii=False,indent=1)
print(len(products),'products',sum(len(p['variants']) for p in products),'variants',len(kits),'kits')
