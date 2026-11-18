/* uebmal.de – Anmeldung, Freigaben und Ergebnis-Meldung */
(function () {
  "use strict";
  var cfg = window.UEBMAL_CONFIG || {};
  var aktiv = !!(cfg.url && cfg.key && window.supabase && window.supabase.createClient);
  var sb = null;
  if (aktiv) {
    try { sb = window.supabase.createClient(cfg.url, cfg.key); } catch (e) { aktiv = false; }
  }
  var skript = document.currentScript && document.currentScript.src;
  var wurzel = skript ? new URL(".", skript).href : "/";
  var DOMAIN = "konto.uebmal.de";
  var QKEY = "uebmal-warteschlange";

  var SEITEN = [
    { id: "englisch-sa1", fach: "Englisch", stufe: "Klasse 5 · Green Line 1", titel: "Schulaufgabe Unit 1",
      text: "Grammar, Vocabulary, Writing, Listening", pfad: "englisch/" },
    { id: "mathe-riesenzahlen", fach: "Mathe", stufe: "Klasse 5", titel: "Mission Riesenzahlen",
      text: "Große Zahlen, Runden, Zahlenstrahl, negative Zahlen", pfad: "mathe/" },
    { id: "latein-campus1", fach: "Latein", stufe: "Klasse 5 · Campus B1", titel: "Kapitel 1–9",
      text: "Vokabeln, Formen, Sätze, Probe-Schulaufgabe", pfad: "latein/" },
    { id: "mathe-delta5-sa1", fach: "Mathe", stufe: "Klasse 5 · Delta 5", titel: "Schulaufgabe Kapitel 1 und 2",
      text: "Große Zahlen, Runden, ganze Zahlen, Terme, Gleichungen", pfad: "mathe-delta5/" }
  ];
  /* Konten, die die bisherige (klassische) Oberfläche sehen statt des Abenteuer-Looks */
  var KLASSISCH = ["benedikt", "maria-cristina"];

  function seite(id) { return SEITEN.filter(function (s) { return s.id === id; })[0] || null; }
  function email(name) { return String(name).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "") + "@" + DOMAIN; }

  function lies() { try { return JSON.parse(localStorage.getItem(QKEY) || "[]") || []; } catch (e) { return []; } }
  function schreib(q) { try { localStorage.setItem(QKEY, JSON.stringify(q.slice(-200))); } catch (e) {} }

  var U = {
    aktiv: aktiv, sb: sb, SEITEN: SEITEN, wurzel: wurzel, seite: seite, email: email,
    user: null, profil: null, kontext: null,
    klassisch: function (p) { return !!p && KLASSISCH.indexOf(p.benutzername) >= 0; },

    sitzung: async function () {
      if (!aktiv) return null;
      try { var r = await sb.auth.getSession(); return (r.data && r.data.session) || null; }
      catch (e) { return null; }
    },
    ladeProfil: async function (uid) {
      var r = await sb.from("profile").select("id, benutzername, anzeigename, rolle").eq("id", uid).maybeSingle();
      if (r.error) throw r.error;
      return r.data;
    },
    ladeFreigaben: async function (uid) {
      var r = await sb.from("freigaben").select("seite").eq("user_id", uid);
      if (r.error) throw r.error;
      return (r.data || []).map(function (x) { return x.seite; });
    },
    anmelden: async function (name, passwort) {
      var r = await sb.auth.signInWithPassword({ email: email(name), password: passwort });
      if (r.error) throw r.error;
      return r.data.session;
    },
    abmelden: async function () {
      try { await sb.auth.signOut(); } catch (e) {}
      location.href = wurzel;
    },

    /* Trainer-Seiten rufen das im <head> auf: ohne Anmeldung oder Freigabe geht es zur Startseite. */
    schuetze: function (seitenId) {
      var s = seite(seitenId);
      U.kontext = s;
      if (!aktiv) return Promise.resolve(null);
      var root = document.documentElement;
      root.style.visibility = "hidden";
      var zeigen = function () { root.style.visibility = ""; };
      var weg = function (mit) { location.replace(wurzel + (mit ? "?weiter=" + encodeURIComponent(s ? s.pfad : "") : "")); };
      return (async function () {
        var sitz = await U.sitzung();
        if (!sitz) { weg(true); return null; }
        U.user = sitz.user;
        try {
          var p = await U.ladeProfil(sitz.user.id);
          U.profil = p;
          if (!p) { weg(false); return null; }
          if (p.rolle !== "eltern") {
            var f = await U.ladeFreigaben(sitz.user.id);
            if (f.indexOf(seitenId) < 0) { weg(false); return null; }
          }
        } catch (e) {
          /* kein Netz: mit vorhandener Anmeldung weiterüben, Ergebnisse werden nachgereicht */
        }
        zeigen();
        U.nachreichen();
        return sitz;
      })().catch(function () { zeigen(); return null; });
    },

    /* Eine Übungsrunde melden. Scheitert das (kein Netz), wird sie später nachgereicht. */
    melde: function (e) {
      if (!aktiv || !U.user) return;
      if (U.profil && U.profil.rolle === "eltern") return;   /* Eltern-Tests nicht mitzählen */
      var k = U.kontext || {};
      var gesamt = Math.max(1, Math.round(e.gesamt || 0));
      var zeile = {
        user_id: U.user.id,
        zeit: new Date().toISOString(),
        seite: k.id || "unbekannt",
        fach: k.fach || "",
        modul: String(e.modul || ""),
        titel: String(e.titel || "").slice(0, 120),
        richtig: Math.max(0, Math.min(gesamt, Math.round(e.richtig || 0))),
        gesamt: gesamt,
        dauer_s: e.dauer_s == null ? null : Math.max(0, Math.min(4 * 3600, Math.round(e.dauer_s))),
        abgeschlossen: e.abgeschlossen !== false,
        fehler: (e.fehler || []).slice(0, 60)
      };
      var q = lies(); q.push(zeile); schreib(q);
      U.nachreichen();
    },
    nachreichen: async function () {
      if (!aktiv || !U.user || U._sendet) return;
      U._sendet = true;
      try {
        var q = lies();
        var meine = q.filter(function (z) { return z.user_id === U.user.id; });
        if (meine.length) {
          var r = await sb.from("ergebnisse").insert(meine);
          if (!r.error) {
            var jetzt = lies().filter(function (z) {
              return !meine.some(function (m) { return m.user_id === z.user_id && m.zeit === z.zeit && m.modul === z.modul; });
            });
            schreib(jetzt);
          }
        }
      } catch (e) {}
      U._sendet = false;
    }
  };
  window.Uebmal = U;
  window.addEventListener("online", function () { U.nachreichen(); });
})();
