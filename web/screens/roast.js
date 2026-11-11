// Screen without a tab for starting and running a roast:
//   #/roast/new           setup sheet → Charge
//   #/roast/new/<id>      same, pre-filled from an earlier roast ("Roast this again", SPEC §2.3)
//   #/roast/live   the live timer (full screen: tab bar hidden)
import * as setup from "./roast-setup.js";
import * as live from "./live-roast.js";

export const title = "Roast";

export const fullscreen = params => params[0] === "live";

export function render(root, { params }) {
  if (params[0] === "live") return live.render(root);
  if (params[0] === "new") return setup.render(root, { planId: params[1] ?? null });
  throw new Error("That page doesn't exist.");
}
