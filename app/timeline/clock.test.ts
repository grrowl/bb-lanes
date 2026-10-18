import { describe, expect, it } from "vitest";
import { ClockFollower } from "./clock";

function follower(start: number) {
  let real = 1_000;
  const clock = new ClockFollower(start, () => real);
  return { clock, advance: (ms: number) => (real += ms) };
}

describe("ClockFollower", () => {
  it("holds a frozen clock still, as upstream draws exactly at now", () => {
    const { clock, advance } = follower(5_000);
    advance(2_000);
    expect(clock.read()).toBe(5_000);
    clock.sync(5_000);
    expect(clock.read()).toBe(5_000);
  });

  it("follows real time once the clock moves", () => {
    const { clock, advance } = follower(5_000);
    advance(250);
    clock.sync(5_250);
    expect(clock.rate).toBe(1);
    advance(100);
    expect(clock.read()).toBe(5_350);
  });

  it("learns an accelerated demo clock from its first step", () => {
    const { clock, advance } = follower(0);
    advance(100);
    clock.sync(3_000);
    expect(clock.rate).toBe(30);
    advance(10);
    expect(clock.read()).toBe(3_300);
  });

  it("smooths jitter after that", () => {
    const { clock, advance } = follower(0);
    advance(250);
    clock.sync(250);
    advance(250);
    clock.sync(520);
    expect(clock.rate).toBe(1);
  });
});
