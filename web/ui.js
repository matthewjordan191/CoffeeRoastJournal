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
export function segmented({ name, label, options, value, onChange }) {
  const inputs = options.map(o =>
    h("input", { type: "radio", name, value: o.value, checked: o.value === value,
      onchange: e => e.target.checked && onChange(o.value) }));
  const el = h("div", { class: "row" },
    h("span", { class: "row-label", id: `${name}-label` }, label),
    h("div", { class: "seg", role: "radiogroup", "aria-labelledby": `${name}-label` },
      options.map((o, i) => h("label", null, inputs[i], h("span", null, o.label)))),
  );
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
