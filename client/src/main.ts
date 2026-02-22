import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { SetupScene } from "./scenes/SetupScene";
import { MatchmakingScene } from "./scenes/MatchmakingScene";
import { GameScene } from "./scenes/GameScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 800,
  backgroundColor: "#1a1008",
  parent: document.body,
  scene: [BootScene, LobbyScene, SetupScene, MatchmakingScene, GameScene],
};

new Phaser.Game(config);
