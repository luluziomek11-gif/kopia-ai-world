/** Replace this manifest to plug in another atlas without changing simulation logic.
 * Rows: front-right, front-left, back-left, back-right.
 * Columns: standing, walking A/B, sitting at work, resting, talking.
 * Tight crops align every pose by its feet, including seated frames. */
const edithBounds = [
  [28,267],[28,268],[28,267],[81,261],[56,261],[27,270],
  [286,522],[286,521],[286,521],[336,520],[312,514],[286,524],
  [536,750],[535,753],[535,753],[588,757],[564,745],[535,753],
  [766,989],[770,997],[769,991],[813,987],[784,967],[766,991],
];
export const EDITH_FRAMES = edithBounds.map(([top,bottom],index) => ({
  x:(index%6)*256, y:top-2, width:256, height:bottom-top+5,
}));

const ultronBounds = [
  [24,264],[26,263],[24,264],[54,268],[62,268],[24,266],
  [274,516],[277,516],[275,515],[305,518],[313,518],[274,518],
  [525,762],[525,759],[526,760],[559,759],[558,759],[525,759],
  [772,1006],[770,1005],[772,1005],[790,998],[796,998],[772,1001],
];
export const ULTRON_FRAMES = ultronBounds.map(([top,bottom],index)=>({
  x:(index%6)*256,y:top,width:256,height:bottom-top,
}));
