// Small DOM helpers shared by every screen. Text always goes in through
// text nodes, never innerHTML, so user-entered names and notes can't inject
// markup. The only innerHTML is the static icon strings below.

/**
 * h("button", { class: "btn", onclick: fn, "aria-label": "Add" }, "Add")
 * Props: `class`, `dataset`, on* listeners, `value`/`checked` (set as
 * properties); everything else becomes an attribute (true → "", false/null → skipped).
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "value" || k === "checked") el[k] = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  el.append(...children.flat(Infinity).filter(c => c != null && c !== false));
  return el;
}

/**
 * Append children to `parent`, skipping null/false and flattening arrays.
 * Use this instead of parent.append() for conditional content: the DOM's
 * append() turns a null argument into the text "null".
 */
export function mount(parent, ...children) {
  parent.append(...children.flat(Infinity).filter(c => c != null && c !== false));
  return parent;
}

// 24×24 stroke icons, drawn for this app. currentColor so CSS sets the color.
const ICON_PATHS = {
  roasts:
    '<path d="M12 2.8c.6 3.1 4.7 5.3 4.7 10a4.7 4.7 0 0 1-9.4 0c0-2.3 1.2-3.9 2.5-5.2.1 1.7.8 2.7 1.9 3.2-.4-2.9-.6-5.4.3-8z"/>',
  beans:
    '<ellipse cx="12" cy="12" rx="6.2" ry="8.8" transform="rotate(35 12 12)"/>' +
    '<path d="M7.4 18.6C9.8 15.6 9.4 13.2 12 12s2.4-3.6 4.6-6.6"/>',
  tastings:
    '<path d="M4 9.5h12v3.8a6 6 0 0 1-12 0z"/><path d="M16 10.5h1.4a2.6 2.6 0 0 1 0 5.2H16"/>' +
    '<path d="M8 3.5c-.9 1 .9 2 0 3.2M12 3.5c-.9 1 .9 2 0 3.2"/>',
  stats: '<path d="M5 20v-6M10 20V8M15 20v-9M20 20V4"/>',
  settings:
    '<path d="M4 7h8M18 7h2M4 17h2M12 17h8"/><circle cx="15" cy="7" r="2.6"/><circle cx="9" cy="17" r="2.6"/>',
  chevron: '<path d="M9.5 6l6 6-6 6"/>',
  back: '<path d="M15 5.5L8.5 12l6.5 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

export function icon(name, className = "icon") {
  const span = document.createElement("span");
  span.className = className;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML =
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] ?? ""}</svg>`;
  return span;
}

/** Sticky screen title bar; `actions` go on the right. */
export function screenHeader(title, ...actions) {
  return h("header", { class: "screen-head" },
    h("h1", { tabindex: "-1" }, title),
    actions.length ? h("div", { class: "screen-actions" }, actions) : null,
  );
}

/**
 * Header for a sub-page: a Back button row (plus an optional action on the
 * right), then the large title. `onBack` decides where Back goes.
 */
export function subHeader({ title, backLabel, onBack, action, subtitle }) {
  // Two siblings, not one wrapper: only the bar is sticky (it must be a
  // direct child of the tall screen container); the big title scrolls away.
  const frag = document.createDocumentFragment();
  frag.append(
    h("nav", { class: "sub-head-bar", "aria-label": "Page" },
      h("button", { type: "button", class: "back-btn", onclick: onBack }, icon("back"), backLabel),
      action ?? null),
    h("header", { class: "sub-head" },
      h("h1", { tabindex: "-1" }, title),
      subtitle ? h("p", { class: "sub-head-subtitle" }, subtitle) : null),
  );
  return frag;
}

/**
 * A labelled form field. `input` is any input/select/textarea element;
 * `suffix` (e.g. "g") renders inside the box. Returns { el, input, setError }.
 */
export function field({ id, label, input, hint, suffix, optional = false }) {
  input.id = id;
  const hintEl = hint ? h("p", { class: "field-hint", id: `${id}-hint` }, hint) : null;
  const errEl = h("p", { class: "field-error", id: `${id}-error` });
  input.setAttribute("aria-describedby", [hintEl && `${id}-hint`, `${id}-error`].filter(Boolean).join(" "));
  input.addEventListener("input", () => setError("")); // clear as soon as it's being fixed
  const box = suffix
    ? h("div", { class: "input-wrap input-wrap-full" }, input, h("span", { class: "suffix", "aria-hidden": "true" }, suffix))
    : input;
  const el = h("div", { class: "field" },
    h("label", { class: "field-label", for: id }, label, optional ? h("span", { class: "optional" }, " optional") : null),
    box, hintEl, errEl);
  function setError(message) {
    errEl.textContent = message || "";
    input.toggleAttribute("aria-invalid", !!message);
    (suffix ? box : input).classList.toggle("invalid", !!message);
  }
  return { el, input, setError };
}

/** Text-like input with the app's styling. Pass `value` to prefill. */
export function textInput(props = {}) {
  return h("input", { type: "text", autocomplete: "off", ...props, class: `text-input ${props.class ?? ""}`.trim() });
}

/** "Low" / "Out" stock pill (see derive.stockStatus); nothing when stock is fine. */
export function stockBadge(status) {
  if (status === "low") return h("span", { class: "pill pill-warn" }, "Low");
  if (status === "out") return h("span", { class: "pill pill-danger" }, "Out");
  return null;
}

/** Empty-state card for screens that aren't built yet. */
export function placeholder({ iconName, heading, body }) {
  return h("section", { class: "empty" },
    h("div", { class: "empty-icon" }, icon(iconName)),
    h("h2", null, heading),
    h("p", null, body),
    h("p", { class: "badge" }, "Coming soon"),
  );
}

/** Grouped settings-style list: a titled card of rows. */
export function section(title, ...rows) {
  return h("section", { class: "section" },
    h("h2", { class: "section-title" }, title),
    h("div", { class: "card" }, rows),
  );
}

/**
 * Radio-button segmented control.
 * options: [{ value, label }]; onChange(value). Returns { el, set(value) }.
 */
export function segmented({ name, label, ariaLabel, options, value, onChange }) {
  const inputs = options.map(o =>
    h("input", { type: "radio", name, value: o.value, checked: o.value === value,
      onchange: e => e.target.checked && onChange(o.value) }));
  const labels = options.map((o, i) => h("label", null, inputs[i], h("span", null, o.label)));
  // With a label: a settings row. Without (ariaLabel only): just the control.
  const el = label
    ? h("div", { class: "row" },
        h("span", { class: "row-label", id: `${name}-label` }, label),
        h("div", { class: "seg", role: "radiogroup", "aria-labelledby": `${name}-label` }, labels))
    : h("div", { class: "seg seg-full", role: "radiogroup", "aria-label": ariaLabel }, labels);
  return { el, set(v) { inputs.forEach(i => { i.checked = i.value === v; }); } };
}

/**
 * − value + stepper for integer settings (fan/heat).
 * Returns { el, set(value) }. onChange(next) fires on each tap.
 */
export function stepper({ id, label, hint, value, min, max, onChange }) {
  const out = h("output", { id: `${id}-value`, "aria-live": "polite" });
  const dec = h("button", { type: "button", class: "step-btn", "aria-label": `Decrease ${label.toLowerCase()}` }, "−");
  const inc = h("button", { type: "button", class: "step-btn", "aria-label": `Increase ${label.toLowerCase()}` }, "+");
  let current = value;
  function set(v) {
    current = v;
    out.textContent = String(v);
    dec.disabled = v <= min;
    inc.disabled = v >= max;
  }
  dec.addEventListener("click", () => current > min && onChange(current - 1));
  inc.addEventListener("click", () => current < max && onChange(current + 1));
  set(value);
  const el = h("div", { class: "row" },
    h("div", { class: "row-text" },
      h("span", { class: "row-label", id: `${id}-label` }, label),
      hint ? h("span", { class: "row-hint" }, hint) : null),
    h("div", { class: "stepper", role: "group", "aria-labelledby": `${id}-label` }, dec, out, inc),
  );
  return { el, set };
}

// One app-wide polite live region + visual toast, for "Saved" and errors.
let toastEl = null;
let toastTimer = 0;
export function toast(message, { error = false } = {}) {
  toastEl ??= document.getElementById("toast");
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.toggle("error", error);
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), error ? 4000 : 1400);
}

// ---------------------------------------------------------------- dialogs
//
// In-app sheets built on <dialog> (focus stays inside; Escape or a tap on
// the backdrop cancels). Used instead of window.confirm/prompt, which look
// out of place in the installed app and can't be styled for big targets.

function openSheet(build) {
  return new Promise(resolve => {
    const dialog = h("dialog", { class: "sheet" });
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    build(dialog, finish);
    dialog.addEventListener("cancel", e => { e.preventDefault(); finish(null); });   // Escape
    dialog.addEventListener("click", e => { if (e.target === dialog) finish(null); }); // backdrop
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Confirm with big buttons. Resolves true / false. The cancel button gets
 * focus, so a stray Enter never confirms something destructive.
 */
export function confirmSheet({ title, body, confirmLabel = "OK", cancelLabel = "Cancel", danger = false }) {
  return openSheet((dialog, finish) => {
    const cancel = h("button", { type: "button", class: "btn sheet-btn", autofocus: true, onclick: () => finish(false) }, cancelLabel);
    const ok = h("button", { type: "button", class: `btn sheet-btn ${danger ? "btn-danger-solid" : "btn-accent"}`, onclick: () => finish(true) }, confirmLabel);
    mount(dialog,
      h("h2", { class: "sheet-title" }, title),
      body ? h("p", { class: "sheet-body" }, body) : null,
      h("div", { class: "sheet-actions" }, cancel, ok));
  }).then(v => v === true);
}

/**
 * Ask for one value. `validate(text)` returns an error message or null.
 * Resolves the trimmed text, or null if cancelled.
 */
export function inputSheet({ title, label, hint, suffix, inputmode, multiline = false, placeholder, saveLabel = "Save", validate }) {
  return openSheet((dialog, finish) => {
    const input = multiline
      ? h("textarea", { class: "text-input", rows: "3", placeholder })
      : textInput({ inputmode, placeholder, enterkeyhint: "done" });
    const f = field({ id: "sheet-input", label, hint, suffix, input });
    const form = h("form", { method: "dialog", novalidate: true, onsubmit: e => {
      e.preventDefault();
      const text = input.value.trim();
      const error = validate?.(text) ?? (text ? null : "Enter something, or cancel.");
      if (error) { f.setError(error); input.focus(); return; }
      finish(text);
    } },
      h("h2", { class: "sheet-title" }, title),
      f.el,
      h("div", { class: "sheet-actions" },
        h("button", { type: "button", class: "btn sheet-btn", onclick: () => finish(null) }, "Cancel"),
        h("button", { type: "submit", class: "btn sheet-btn btn-accent" }, saveLabel)));
    dialog.append(form);
    queueMicrotask(() => input.focus());
  });
}

/**
 * Press-and-hold button for actions that must not happen by accident
 * (Cool). Fires onConfirm(pressStartMs) after `holdMs`; releasing early
 * cancels and shows `hint`. Pointer Events, so it works for touch and mouse.
 */
export function holdButton({ label, holdMs = 800, hint = "Hold to confirm", className = "", onConfirm }) {
  const fill = h("span", { class: "hold-fill", "aria-hidden": "true" });
  const text = h("span", { class: "hold-label" }, label);
  const btn = h("button", { type: "button", class: `hold-btn ${className}`, style: `--hold-ms:${holdMs}ms` }, fill, text);
  let timer = 0;
  let startedAt = 0;

  const begin = () => {
    if (timer) return;
    startedAt = Date.now();
    btn.classList.add("holding");
    timer = setTimeout(() => {
      timer = 0;
      btn.classList.remove("holding");
      onConfirm(startedAt);
    }, holdMs);
  };
  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
    btn.classList.remove("holding");
    text.textContent = hint;
    setTimeout(() => { text.textContent = label; }, 1600);
  };

  btn.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    try { btn.setPointerCapture(e.pointerId); } catch { /* capture is a nicety; the hold still works */ }
    begin();
  });
  btn.addEventListener("pointerup", cancel);
  btn.addEventListener("pointercancel", cancel);
  btn.addEventListener("lostpointercapture", cancel);
  btn.addEventListener("contextmenu", e => e.preventDefault());
  // Keyboard: hold Space/Enter.
  btn.addEventListener("keydown", e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); begin(); } });
  btn.addEventListener("keyup", e => { if (e.key === " " || e.key === "Enter") cancel(); });
  return btn;
}
