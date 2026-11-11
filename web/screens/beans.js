// Beans: green coffee and remaining stock (SPEC §5). Placeholder.
import { screenHeader, placeholder } from "../ui.js";

export const title = "Beans";

export function render(root) {
  root.append(
    screenHeader(title),
    placeholder({
      iconName: "beans",
      heading: "No beans yet",
      body: "Add the green coffees you buy, log each purchase, and see how much is left to roast.",
    }),
  );
}
