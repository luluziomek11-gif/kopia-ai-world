import Phaser from 'phaser';

/** One continuous painting; column frames register its shared walls to the tile grid. */
export function drawEastWing(scene: Phaser.Scene): void {
  const texture = scene.textures.get('room');
  const boundaries = [0, 611, 1212, 1881];
  for (let column = 0; column < 3; column++) {
    const frame = 'house-column-' + column;
    texture.add(frame, 0, boundaries[column], 0, boundaries[column + 1] - boundaries[column], 836);
    scene.add.image(column * 768, 0, 'room', frame).setOrigin(0).setDisplaySize(768, 1024).setDepth(0);
  }
}
