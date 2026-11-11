// Roasts: history + Start Roast (SPEC §5). Placeholder until the live roast flow is built.
import { screenHeader, placeholder } from "../ui.js";

export const title = "Roasts";

export function render(root) {
  root.append(
    screenHeader(title),
    placeholder({
      iconName: "roasts",
      heading: "No roasts yet",
      body: "Your roast history will live here, with a Start Roast button that opens the live timer.",
    }),
  );
}
