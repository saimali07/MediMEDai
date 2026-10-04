import { initPage, $, showError, showToast } from "../ui.js";
import { signUp, getUser } from "../auth.js";

await initPage({});
if (await getUser()) location.replace("dashboard.html");

$("#toggle-pass").addEventListener("click", (e) => {
  const i = $("#auth-pass"); i.type = i.type === "password" ? "text" : "password";
  e.target.textContent = i.type === "password" ? "Show" : "Hide";
});

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#auth-email").value.trim(), pass = $("#auth-pass").value, name = $("#auth-name").value.trim();
  const err = $("#auth-error");
  if (!email) return showError(err, "Enter your email address.");
  if (pass.length < 8) return showError(err, "Use a password of at least 8 characters.");
  if (!$("#auth-consent").checked) return showError(err, "Please confirm you understand this is educational guidance.");
  const btn = $("#auth-submit"); btn.disabled = true; showError(err, "");
  try {
    const { session } = await signUp(email, pass, name);
    if (session) { location.href = "dashboard.html"; return; }
    showToast("Check your email to confirm your account, then sign in.");
    $("#auth-form").reset();
    showError(err, "");
    btn.disabled = false;
  } catch (ex) {
    showError(err, ex.message || "Could not create the account.");
    btn.disabled = false;
  }
});
