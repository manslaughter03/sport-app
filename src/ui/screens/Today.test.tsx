// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/preact";
import { Today } from "./Today.tsx";

// Proves the component runner is wired too (jsdom + Testing Library), which the
// real component tests in S6 will rely on.
describe("Today", () => {
  it("renders the app heading", () => {
    render(<Today />);
    expect(screen.getByRole("heading", { name: "Sport" })).toBeTruthy();
  });
});
