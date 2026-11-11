// Tastings: cups brewed from each roast (SPEC §5). Placeholder.
import { screenHeader, placeholder } from "../ui.js";

export const title = "Tastings";

export function render(root) {
  root.append(
    screenHeader(title),
    placeholder({
      iconName: "tastings",
      heading: "No tastings yet",
      body: "Score the cups you brew from each roast, with method, recipe and flavor notes.",
    }),
  );
}
