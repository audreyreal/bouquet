import { regionControlAction } from "../spec";

export const ejectNationAction = regionControlAction({
  type: "eject-nation",
  title: "Eject Nation",
  blurb: "Eject a nation from the region, one at a time.",
  verb: "Eject",
  needle: "has been ejected from ",
  body: (nation) => ({ nation_name: nation, eject: "1" }),
  powers: "B",
});

export const banjectNationAction = regionControlAction({
  type: "banject-nation",
  title: "Banject Nation",
  blurb: "Eject and ban a nation, one at a time.",
  verb: "Banject",
  needle: "has been ejected and banned from ",
  body: (nation) => ({ nation_name: nation, ban: "1" }),
  powers: "B",
});
