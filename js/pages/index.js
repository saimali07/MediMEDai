import { initPage, $, t, getLang } from "../ui.js";
import { classifyDemo, emergencyNumber } from "../safety.js";

await initPage({ active: "assess" });

const LEVELS = {
  self_care: { pos: 12.5, color: "u-self", key: "scale_self" },
  routine: { pos: 37.5, color: "u-routine", key: "scale_routine" },
  urgent: { pos: 62.5, color: "u-urgent", key: "scale_urgent" },
  emergency: { pos: 87.5, color: "u-emergency", key: "scale_emergency" },
};
const input = $("#demo-input");

function render() {
  const level = classifyDemo(input.value);
  const L = LEVELS[level];
  const pointer = $("#demo-pointer"), badge = $("#demo-badge");
  pointer.style.left = `${L.pos}%`;
  pointer.style.borderColor = `var(--${L.color})`;
  badge.style.background = `var(--${L.color}-bg)`;
  badge.style.color = `var(--${L.color})`;
  $("#demo-badge-text").textContent = t(L.key);
  Object.keys(LEVELS).forEach((k) => $(`#lbl-${k}`).classList.toggle("active", k === level));
  $("#demo-emergency-banner").classList.toggle("hidden", level !== "emergency");
  $("#demo-call").href = `tel:${emergencyNumber()}`;
}

input.addEventListener("input", render);
document.querySelectorAll("[data-demo]").forEach((b) => b.addEventListener("click", () => { input.value = b.dataset.demo; render(); }));
document.addEventListener("langchange", render);
$("#how-btn").addEventListener("click", () => $("#ways-in").scrollIntoView({ behavior: "smooth" }));
render();
