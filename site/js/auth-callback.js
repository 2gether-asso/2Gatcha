// Page de retour du flux OAuth Discord (redirect_uri).
// Recupere ?code=... dans l'URL, l'echange cote n8n (discord-login.json) et
// stocke la session avant de revenir a l'accueil.

document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const errorParam = params.get("error");
  const statusLabel = document.getElementById("status-label");
  const errorZone = document.getElementById("error-zone");

  if (errorParam) {
    statusLabel.textContent = "Connexion annulee.";
    setTimeout(() => { window.location.href = "index.html"; }, 1500);
    return;
  }

  if (!code) {
    statusLabel.textContent = "Code de connexion manquant.";
    errorZone.innerHTML = `<div class="error-box">Reviens sur la <a href="index.html">page d'accueil</a> et reessaie.</div>`;
    return;
  }

  try {
    const res = await API.discordLogin(code);
    Session.set({
      userId: res.userId,
      pseudo: res.pseudo,
      discordId: res.discordId,
      discordUsername: res.discordUsername,
      discordAvatar: res.discordAvatar
    });
    window.location.href = "index.html";
  } catch (e) {
    statusLabel.textContent = "Connexion impossible.";
    if (e.code === "not_in_guild") {
      window.location.href = "index.html?error=not_in_guild";
      return;
    }
    errorZone.innerHTML = `<div class="error-box">${e.message}. Retourne a la <a href="index.html">page d'accueil</a> et reessaie.</div>`;
  }
});
