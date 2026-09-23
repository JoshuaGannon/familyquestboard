// Family Quest Board — dashboard settings
// ----------------------------------------
// The ONLY required step to go live: paste your Apps Script Web app URL below.
// Leave it blank and the dashboard runs in DEMO MODE with sample data
// (edits are kept in this browser only).
//
// Example: "https://script.google.com/macros/s/AKfycb.../exec"

window.FQB_CONFIG = {
  APPS_SCRIPT_URL: "",

  // How often (seconds) to re-read the Google Sheet + calendar.
  REFRESH_SEC: 60,

  // Where the slideshow gets photos. "auto" tries the local photo server
  // (server.py) first, then falls back to the Google Drive folder via Apps Script.
  // Options: "auto" | "local" | "drive" | "none"
  PHOTO_SOURCE: "auto",

  // Which screen to show at startup and after the idle timeout.
  HOME_SCREEN: "home",
};
