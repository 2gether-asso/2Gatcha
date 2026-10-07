// Page de retour du flux OAuth Discord (redirect_uri).
// Recupere ?code=... dans l'URL, l'échange cote API (discord-login.json) et
// stocke la session avant de revenir a l'accueil.

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const errorParam = params.get("error");
  const statusLabel = document.getElementById("status-label");
  const errorZone = document.getElementById("error-zone");

  if (errorParam) {
    statusLabel.textContent = "Connexion annulée.";
    setTimeout(() => { window.location.href = "index.html"; }, 1500);
    return;
  }

  if (!code) {
    statusLabel.textContent = "Code de connexion manquant.";
    errorZone.innerHTML = `<div class="error-box">Reviens sur la <a href="index.html">page d'accueil</a> et réessaie.</div>`;
    return;
  }

  try {
    const res = await API.discordLogin(code);
    Session.set({
      userId: res.userId,
      pseudo: res.pseudo,
      discordId: res.discordId,
      discordUsername: res.discordUsername,
      discordAvatar: res.discordAvatar,
      token: res.token
    });
    try { sessionStorage.setItem("2gatcha_just_logged_in", "1"); } catch (e) {}
    // Page demandee avant la connexion (ex. admin.html pendant une maintenance).
    let next = "index.html";
    try { const n = sessionStorage.getItem("2gatcha_after_login"); if (n === "admin.html") next = n; sessionStorage.removeItem("2gatcha_after_login"); } catch (e) {}
    window.location.href = next;
  } catch (e) {
    statusLabel.textContent = "Connexion impossible.";
    if (e.code === "not_in_guild") {
      window.location.href = "index.html?error=not_in_guild";
      return;
    }
    // Code Discord a usage unique deja utilise (page rechargee, bouton retour...).
    if (e.code === "invalid_code") {
      if (Session.isLoggedIn()) { window.location.href = "index.html"; return; }
      statusLabel.textContent = "Lien de connexion expiré.";
      errorZone.innerHTML = `<div class="error-box">Ce lien de connexion Discord a déjà servi. Retourne à la <a href="index.html">page d'accueil</a> et clique à nouveau sur « Se connecter avec Discord ».</div>`;
      return;
    }
    errorZone.innerHTML = `<div class="error-box">${e.message}. Retourne à la <a href="index.html">page d'accueil</a> et réessaie.</div>`;
  }
});
