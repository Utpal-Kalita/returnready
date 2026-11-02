/* ReturnReady - local-first return-deadline tracker.
   Storage: purchases in localStorage, receipt images in IndexedDB.
   All dates are plain local calendar days (YYYY-MM-DD at local midnight),
   so DST never shifts a countdown. */
"use strict";

const LS_KEY = "returnready.purchases.v1";
let purchases = [];
let filter = "all";
let pendingReceipt = null; // {dataUrl} chosen in the dialog

/* ---------- date helpers (calendar-day math, no UTC shifts) ---------- */

function parseDay(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d); // local midnight
}
function todayMidnight() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function addDays(date, days) {
  const r = new Date(date);
  r.setDate(r.getDate() + days);
  return r;
}
function fmtDay(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
// Whole days remaining; negative means the window closed that many days ago.
function daysLeft(returnByStr) {
  const diff = parseDay(returnByStr) - todayMidnight();
  return Math.round(diff / 86400000);
}

/* ---------- persistence ---------- */

function load() {
  try { purchases = JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch { purchases = []; }
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(purchases)); }

const idb = {
  open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open("returnready", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("receipts");
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  },
  async put(id, dataUrl) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction("receipts", "readwrite");
      tx.objectStore("receipts").put(dataUrl, id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  },
  async get(id) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const req = db.transaction("receipts").objectStore("receipts").get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  },
  async del(id) {
    const db = await this.open();
    return new Promise((res) => {
      const tx = db.transaction("receipts", "readwrite");
      tx.objectStore("receipts").delete(id);
      tx.oncomplete = res;
    });
  },
};

/* ---------- status logic ---------- */

function statusOf(p) {
  if (p.returned) return { key: "returned", label: "Returned" };
  const left = daysLeft(p.returnBy);
  if (left < 0) return { key: "expired", label: `Closed ${-left}d ago`, left };
  if (left <= 2) return { key: "urgent", label: `${left}d left`, left };
  if (left <= 7) return { key: "soon", label: `${left}d left`, left };
  return { key: "safe", label: `${left}d left`, left };
}

/* ---------- rendering ---------- */

const cardsEl = document.getElementById("cards");

async function render() {
  const active = purchases.filter((p) => !p.returned && daysLeft(p.returnBy) >= 0);
  const urgent = active.filter((p) => { const l = daysLeft(p.returnBy); return l >= 0 && l <= 2; });
  const expired = purchases.filter((p) => !p.returned && daysLeft(p.returnBy) < 0);
  const atRisk = active.reduce((s, p) => s + (p.price || 0), 0);
  document.getElementById("stats").innerHTML = `
    <div class="stat"><b>${active.length}</b><span>open returns</span></div>
    <div class="stat"><b>${urgent.length}</b><span>due within 2 days</span></div>
    <div class="stat"><b>${expired.length}</b><span>windows closed</span></div>
    <div class="stat"><b>${atRisk ? atRisk.toLocaleString(undefined, {style:"currency",currency:"USD"}) : "-"}</b><span>value in open windows</span></div>`;

  let list = [...purchases];
  if (filter === "urgent") list = list.filter((p) => !p.returned && daysLeft(p.returnBy) <= 2);
  else if (filter === "active") list = list.filter((p) => !p.returned);
  else if (filter === "returned") list = list.filter((p) => p.returned);
  // Actionable first: soonest deadline wins; closed windows sink to the bottom.
  list.sort((a, b) => {
    if (a.returned !== b.returned) return a.returned ? 1 : -1;
    const la = daysLeft(a.returnBy), lb = daysLeft(b.returnBy);
    const ea = la < 0 ? 1 : 0, eb = lb < 0 ? 1 : 0;
    if (ea !== eb) return ea - eb;
    return la - lb;
  });

  document.getElementById("empty").hidden = list.length > 0;
  cardsEl.innerHTML = "";
  for (const p of list) {
    const st = statusOf(p);
    const card = document.createElement("article");
    card.className = `card ${st.key}`;
    const receipt = p.hasReceipt ? await idb.get(p.id) : null;
    card.innerHTML = `
      ${receipt
        ? `<img class="thumb" src="${receipt}" alt="Receipt for ${escapeHtml(p.name)}" data-view="${p.id}">`
        : `<div class="thumb placeholder" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#a9a493" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v20l-2-1.5L14 22l-2-1.5L10 22l-2-1.5L6 22z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/></svg></div>`}
      <div class="card-main">
        <h3>${escapeHtml(p.name)}</h3>
        <div class="meta">${escapeHtml(p.store)} · bought ${fmtDay(parseDay(p.purchaseDate))} · return by ${fmtDay(parseDay(p.returnBy))}${p.price ? " · " + p.price.toLocaleString(undefined,{style:"currency",currency:"USD"}) : ""}</div>
      </div>
      <div class="countdown ${st.key}"><b>${st.left === undefined ? "✓" : Math.abs(st.left)}</b><span>${st.left === undefined ? "done" : (st.left < 0 ? "days overdue" : "days left")}</span></div>
      <div class="card-actions">
        ${p.returned
          ? `<button data-act="reopen" data-id="${p.id}">Reopen</button>`
          : `<button data-act="returned" data-id="${p.id}">Mark returned</button>`}
        <button data-act="edit" data-id="${p.id}">Edit</button>
        <button data-act="delete" data-id="${p.id}">Delete</button>
      </div>`;
    cardsEl.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- dialog ---------- */

const dialog = document.getElementById("purchaseDialog");
const form = document.getElementById("purchaseForm");

function openDialog(p) {
  form.reset();
  pendingReceipt = null;
  document.getElementById("receiptPreview").innerHTML = "";
  document.getElementById("dialogTitle").textContent = p ? "Edit purchase" : "Add purchase";
  document.getElementById("fId").value = p ? p.id : "";
  document.getElementById("fName").value = p ? p.name : "";
  document.getElementById("fStore").value = p ? p.store : "";
  document.getElementById("fDate").value = p ? p.purchaseDate : new Date().toISOString().slice(0, 10);
  if (p) {
    const days = Math.round((parseDay(p.returnBy) - parseDay(p.purchaseDate)) / 86400000);
    document.querySelector('input[name="policyMode"][value="days"]').checked = true;
    document.getElementById("fDays").value = days;
    document.getElementById("fReturnBy").value = p.returnBy;
  }
  dialog.showModal();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("fId").value || "p" + Date.now().toString(36);
  const purchaseDate = document.getElementById("fDate").value;
  if (!purchaseDate) return;
  const mode = document.querySelector('input[name="policyMode"]:checked').value;
  let returnBy;
  if (mode === "days") {
    const days = Math.max(1, parseInt(document.getElementById("fDays").value, 10) || 30);
    returnBy = addDays(parseDay(purchaseDate), days).toISOString().slice(0, 10);
    // toISOString shifts to UTC; recompute as a plain local day string instead.
    const d = addDays(parseDay(purchaseDate), days);
    returnBy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } else {
    returnBy = document.getElementById("fReturnBy").value;
    if (!returnBy) { document.getElementById("fReturnBy").focus(); return; }
  }
  const existing = purchases.find((x) => x.id === id);
  const rec = {
    id,
    name: document.getElementById("fName").value.trim(),
    store: document.getElementById("fStore").value.trim(),
    purchaseDate,
    returnBy,
    price: parseFloat(document.getElementById("fPrice").value) || null,
    returned: existing ? existing.returned : false,
    hasReceipt: !!(pendingReceipt || (existing && existing.hasReceipt)),
  };
  if (!rec.name || !rec.store) return;
  if (pendingReceipt) await idb.put(id, pendingReceipt);
  purchases = [...purchases.filter((x) => x.id !== id), rec];
  save();
  dialog.close();
  render();
});

document.getElementById("fReceipt").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) { pendingReceipt = null; return; }
  const reader = new FileReader();
  reader.onload = () => {
    // Downscale big photos so localStorage-era quotas are never an issue.
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 900 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      pendingReceipt = c.toDataURL("image/jpeg", 0.82);
      document.getElementById("receiptPreview").innerHTML = `<img src="${pendingReceipt}" alt="Receipt preview">`;
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

/* ---------- events ---------- */

document.getElementById("addBtn").addEventListener("click", () => openDialog(null));
document.getElementById("cancelBtn").addEventListener("click", () => dialog.close());

document.getElementById("filters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-filter]");
  if (!btn) return;
  filter = btn.dataset.filter;
  document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("on", b === btn));
  render();
});

cardsEl.addEventListener("click", async (e) => {
  const view = e.target.closest("[data-view]");
  if (view) {
    const dataUrl = await idb.get(view.dataset.view);
    if (dataUrl) {
      document.getElementById("receiptFull").src = dataUrl;
      document.getElementById("receiptDialog").showModal();
    }
    return;
  }
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const p = purchases.find((x) => x.id === btn.dataset.id);
  if (!p) return;
  if (btn.dataset.act === "returned") p.returned = true;
  else if (btn.dataset.act === "reopen") p.returned = false;
  else if (btn.dataset.act === "edit") { openDialog(p); return; }
  else if (btn.dataset.act === "delete") {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    purchases = purchases.filter((x) => x.id !== p.id);
    await idb.del(p.id);
  }
  save();
  render();
});

load();
render();
