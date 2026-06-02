// Posty subscribe widget. Embed snippet:
//
//   <div data-posty-form
//        data-action="https://yourdomain.com/api/public/subscribe"
//        data-account="<workspace id>"
//        data-group-id="<optional group uuid>"
//        data-success="Thanks. You're on the list."></div>
//   <script src="https://yourdomain.com/posty-form.js" async></script>
//
// Each container becomes a small form. No framework, no dependencies, ~3 KB.
// Posts JSON to `data-action`, then swaps the form for a thank-you message.
//
// Backend endpoint: POST /api/public/subscribe
//   body: { email, firstname?, lastname?, groupId?, account? }
//   returns: { ok: true } or { error: '...' }
//
// `data-account` routes the subscriber into the right workspace. Without
// it the backend falls back to the default workspace (legacy embeds).

(function () {
  'use strict';

  // ---- styles. Injected once. Scoped to .posty-form to avoid clashing with
  // ---- whatever CSS the host site already ships.
  var STYLE_ID = 'posty-form-styles';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.posty-form{font:14px/1.4 -apple-system,Segoe UI,Arial,sans-serif;color:#1f2937;max-width:420px}',
      '.posty-form input{box-sizing:border-box;width:100%;border:1px solid #d1d5db;border-radius:8px;padding:9px 12px;font:inherit;color:inherit;background:#fff}',
      '.posty-form input:focus{outline:none;border-color:#24599a;box-shadow:0 0 0 2px rgba(36,89,154,.18)}',
      '.posty-form-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
      '.posty-form-row > *{flex:1;min-width:140px}',
      '.posty-form button{cursor:pointer;background:#24599a;color:#fff;border:0;border-radius:8px;padding:10px 16px;font:600 14px/1 inherit;width:100%}',
      '.posty-form button:disabled{opacity:.6;cursor:default}',
      '.posty-form-msg{margin-top:8px;font-size:13px}',
      '.posty-form-msg.is-error{color:#9f1d1d}',
      '.posty-form-msg.is-ok{color:#135c2f}',
      '.posty-form-done{background:#f1faf3;border:1px solid #c7e9d4;color:#135c2f;border-radius:10px;padding:14px;text-align:center}',
    ].join('');
    document.head.appendChild(style);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'className') node.className = attrs[key];
        else if (key.indexOf('on') === 0) node[key] = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) {
      if (child == null) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function mount(container) {
    if (container.dataset.postyMounted === '1') return;
    container.dataset.postyMounted = '1';

    var action = container.getAttribute('data-action');
    if (!action) {
      console.warn('[posty-form] missing data-action on container; skipping.');
      return;
    }
    var groupId = container.getAttribute('data-group-id') || null;
    var account = container.getAttribute('data-account') || null;
    var successMessage = container.getAttribute('data-success') || 'Thanks. You\'re on the list.';
    var collectName = container.getAttribute('data-collect-name') !== 'false';

    var firstnameInput = el('input', {
      type: 'text', name: 'firstname', placeholder: 'First name', autocomplete: 'given-name',
    });
    var lastnameInput = el('input', {
      type: 'text', name: 'lastname', placeholder: 'Last name', autocomplete: 'family-name',
    });
    var emailInput = el('input', {
      type: 'email', name: 'email', placeholder: 'you@example.com', required: 'required', autocomplete: 'email',
    });
    var submit = el('button', { type: 'submit' }, [container.getAttribute('data-button-label') || 'Subscribe']);
    var status = el('div', { className: 'posty-form-msg' });

    var nameRow = el('div', { className: 'posty-form-row' }, collectName ? [firstnameInput, lastnameInput] : []);
    var emailRow = el('div', { className: 'posty-form-row' }, [emailInput]);

    var form = el('form', { className: 'posty-form', noValidate: 'noValidate' }, [
      collectName ? nameRow : null,
      emailRow,
      submit,
      status,
    ]);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      status.textContent = '';
      status.className = 'posty-form-msg';

      var email = (emailInput.value || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        status.textContent = 'Enter a valid email address.';
        status.classList.add('is-error');
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Subscribing…';

      var payload = { email: email };
      if (collectName) {
        if (firstnameInput.value.trim()) payload.firstname = firstnameInput.value.trim();
        if (lastnameInput.value.trim()) payload.lastname = lastnameInput.value.trim();
      }
      if (groupId) payload.groupId = groupId;
      if (account) payload.account = account;
      // Auto-detect timezone so send-time-per-timezone campaigns can land in
      // the recipient's local morning, not the admin's. Tolerated server-side
      // if absent.
      try {
        var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) payload.timezone = tz;
      } catch (_e) { /* old browser, skip */ }

      // Fetch with timeout. Don't hang forever if the host is unreachable.
      var controller = (typeof AbortController === 'function') ? new AbortController() : null;
      if (controller) setTimeout(function () { controller.abort(); }, 12000);

      fetch(action, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            if (response.ok && data.ok) return data;
            var err = new Error(data.error || 'Could not subscribe. Try again later.');
            err.status = response.status;
            throw err;
          });
        })
        .then(function () {
          var done = el('div', { className: 'posty-form-done' }, [successMessage]);
          container.replaceChild(done, form);
        })
        .catch(function (error) {
          submit.disabled = false;
          submit.textContent = container.getAttribute('data-button-label') || 'Subscribe';
          status.textContent = error.message || 'Could not subscribe. Try again later.';
          status.classList.add('is-error');
        });
    });

    container.innerHTML = '';
    container.appendChild(form);
  }

  function init() {
    ensureStyles();
    var nodes = document.querySelectorAll('[data-posty-form]');
    for (var i = 0; i < nodes.length; i += 1) mount(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose a small re-init hook for SPAs that inject the container after load.
  window.PostyForm = { mount: mount, init: init };
}());
