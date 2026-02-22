import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { LobbyScene } from "./scenes/LobbyScene";
import { SetupScene } from "./scenes/SetupScene";
import { MatchmakingScene } from "./scenes/MatchmakingScene";
import { GameScene } from "./scenes/GameScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: "#1a1008",
  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: document.body,
    width: "100%",
    height: "100%",
  },
  scene: [BootScene, LobbyScene, SetupScene, MatchmakingScene, GameScene],
};

new Phaser.Game(config);
