import { initPage, $, showError } from "../ui.js";
import { signIn, getUser, safeNext } from "../auth.js";

await initPage({});
const next = safeNext(new URLSearchParams(location.search).get("next"));
if (await getUser()) location.replace(next);

$("#toggle-pass").addEventListener("click", (e) => {
  const i = $("#auth-pass"); i.type = i.type === "password" ? "text" : "password";
  e.target.textContent = i.type === "password" ? "Show" : "Hide";
});

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#auth-email").value.trim(), pass = $("#auth-pass").value;
  if (!email || !pass) return showError($("#auth-error"), "Enter your email and password.");
  const btn = $("#auth-submit"); btn.disabled = true; showError($("#auth-error"), "");
  try { await signIn(email, pass); location.href = next; }
  catch (err) {
    showError($("#auth-error"), /confirm/i.test(err.message) ? "Please confirm your email first — check your inbox for the link." : "Incorrect email or password.");
    btn.disabled = false;
  }
});
