/*
 * CDT Atacado System - optional online storage in a (private) GitHub repository.
 * Each finished order is stored as pedidos/<number>.json through the GitHub REST API,
 * using a fine-grained personal access token that the user pastes on their own device.
 * The token never leaves the browser except to talk to api.github.com.
 */
(function (root) {
  'use strict';
  const API = 'https://api.github.com';
  const FOLDER = 'pedidos';

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function create(config) {
    const repo = String(config.repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    const token = String(config.token || '').trim();
    const branch = config.branch || 'main';
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repositório inválido (use dono/nome)');
    if (!token) throw new Error('Informe o token');
    const shas = {}; // path -> last known blob sha (needed to update/delete)

    async function call(method, path, body, accept) {
      const res = await fetch(API + path, {
        method: method,
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: accept || 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
      if (res.status === 404) return { status: 404, data: null };
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (!res.ok) {
        const msg = (data && data.message) || res.statusText;
        const err = new Error('GitHub ' + res.status + ': ' + msg);
        err.status = res.status;
        throw err;
      }
      return { status: res.status, data: data };
    }

    function filePath(number) {
      return FOLDER + '/' + String(number).replace(/[^A-Za-z0-9_.-]/g, '_') + '.json';
    }

    // Check the token can read the repository; returns { private: bool }.
    async function test() {
      const r = await call('GET', '/repos/' + repo);
      if (r.status === 404) throw new Error('Repositório não encontrado ou sem acesso para este token');
      return { private: !!r.data.private, fullName: r.data.full_name };
    }

    async function listOrders() {
      const r = await call('GET', '/repos/' + repo + '/contents/' + FOLDER + '?ref=' + encodeURIComponent(branch));
      if (r.status === 404 || !Array.isArray(r.data)) return [];
      const files = r.data.filter((f) => f.type === 'file' && /\.json$/.test(f.name));
      const out = [];
      // Download in small batches to stay friendly with rate limits.
      for (let i = 0; i < files.length; i += 6) {
        const batch = files.slice(i, i + 6).map(async (f) => {
          shas[f.path] = f.sha;
          const raw = await call('GET', '/repos/' + repo + '/contents/' + f.path + '?ref=' + encodeURIComponent(branch), null, 'application/vnd.github.raw+json');
          const o = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data;
          if (o && o.number) out.push(o);
        });
        await Promise.all(batch);
      }
      return out;
    }

    async function currentSha(path) {
      if (shas[path]) return shas[path];
      const r = await call('GET', '/repos/' + repo + '/contents/' + path + '?ref=' + encodeURIComponent(branch));
      return r.status === 404 ? undefined : (shas[path] = r.data.sha);
    }

    async function saveOrder(order) {
      const path = filePath(order.number);
      const body = {
        message: 'Pedido ' + order.number + ((order.customer && order.customer.store) ? ' - ' + order.customer.store : ''),
        content: b64encode(JSON.stringify(order, null, 2) + '\n'),
        branch: branch,
      };
      const sha = await currentSha(path);
      if (sha) body.sha = sha;
      try {
        const r = await call('PUT', '/repos/' + repo + '/contents/' + path, body);
        shas[path] = r.data.content.sha;
      } catch (e) {
        if (e.status === 409 || e.status === 422) { // stale sha: refresh once and retry
          delete shas[path];
          const fresh = await currentSha(path);
          if (fresh) body.sha = fresh; else delete body.sha;
          const r = await call('PUT', '/repos/' + repo + '/contents/' + path, body);
          shas[path] = r.data.content.sha;
        } else throw e;
      }
    }

    async function deleteOrder(number) {
      const path = filePath(number);
      const sha = await currentSha(path);
      if (!sha) return;
      await call('DELETE', '/repos/' + repo + '/contents/' + path, { message: 'Excluir pedido ' + number, sha: sha, branch: branch });
      delete shas[path];
    }

    return { repo, test, listOrders, saveOrder, deleteOrder };
  }

  root.GitHubSync = { create };
})(self);
