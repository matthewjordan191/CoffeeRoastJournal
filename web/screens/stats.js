// Stats (SPEC §5). Placeholder.
import { screenHeader, placeholder } from "../ui.js";

export const title = "Stats";

export function render(root) {
  root.append(
    screenHeader(title),
    placeholder({
      iconName: "stats",
      heading: "Nothing to chart yet",
      body: "Roast totals, stock on hand, and how weight loss and development line up with your ratings.",
    }),
  );
}
