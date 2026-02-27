# VASSAL Module — Layers, Obstacles & Overlays

Source: `assets/vassal_v2/Gunslinger_v2.0.vmod` (buildFile.xml)

## Terrain Layers (elevation/visibility system)

Pieces have a `Level` property that assigns them to a display layer.
`LayeredPieceCollection` controls rendering order and visibility toggling.

**Layer order** (bottom to top):
1. Gully
2. Ground
3. Hill
4. 2nd Floor / High hill
5. Foliage
6. 3rd Floor
7. 4th Floor
8. 5th Floor

Each layer also has an `Overlay -` counterpart (e.g. `Overlay - Ground`) used for board overlay pieces that sit on that layer.

**Layer controls**: each layer has a hotkey to "Show Only" that layer (hides all others). A "Reset Layers" button restores all.

**Note**: Layers are purely visual/organizational in VASSAL. No per-hex terrain type, movement cost, or LOS-blocking data exists in the module.

## Obstacles (movable game objects)

Prototype: `Counters - Obstacles` (immobilized on grid, non-movable after placement)

| Name       | gpid | Notes                      |
|------------|------|----------------------------|
| Bale       | 307  |                            |
| Chair      | 308  |                            |
| Moneybag   | 309  | has Money value + VP labels |
| Strongbox  | 1851 | has Money value + VP labels |
| Rock       | 310  |                            |
| Rubble     | 2081 |                            |
| Table      | 311  |                            |
| Buck       | 312  | also has Animal prototype   |
| Stage      | 313  | also has Animal prototype   |

## Map Overlays (multi-floor buildings & train cars)

### Building floor overlays
| Name                          | gpid | Image filename                          |
|-------------------------------|------|-----------------------------------------|
| Board C 2nd Floor Overlay     | 424  | Board C 2nd Floor Overlay.PNG           |
| Board CC 2nd Floor Overlay    | 425  | Board CC 2nd Floor Overlay.PNG          |
| Board DD 2nd Floor Overlay    | 426  | Board DD 2nd Floor Overlay.PNG          |
| Board SM2 2nd Floor Overlay   | 468  | Board SM2 2nd Floor Overlay.PNG         |
| Board SM2 3rd Floor Overlay   | 469  | Board SM2 3rd Floor Overlay.PNG         |
| Board NN 2nd Floor Overlay    | 470  | Board NN 2nd Floor Overlay rev 1.png    |
| Board NN 3rd Floor Overlay    | 471  | Board NN 3rd Floor Overlay rev 1.png    |

### Train car overlays (Rail car overlay prototype, 4-way rotation)
| Name                    | gpid | Image filename                            |
|-------------------------|------|-------------------------------------------|
| Box car interior        | 683  | Box Car Interior Overlay.PNG              |
| Box car roof            | 684  | Box Car Roof Overlay.PNG                  |
| Caboose interior        | 685  | Caboose Interior Overlay.PNG              |
| Caboose roof            | 686  | Caboose Roof Overlay.PNG                  |
| Cattle car interior     | 687  | Cattle Car Interior Overlay.PNG           |
| Cattle car roof         | 688  | Cattle Car Roof Overlay.PNG               |
| Coal car                | 689  | Coal Car Overlay.png                      |
| Express car interior    | 690  | Express Car Interior Overlay.PNG          |
| Passenger-style roof    | 691  | Passenger Style Car Roof Overlay.PNG      |
| Flat car                | 692  | Flat Car Overlay.PNG                      |
| Mail car interior       | 693  | Mail Car Interior Overlay.PNG             |
| Passenger car interior  | 694  | Passenger Car Interior Overlay.PNG        |
| Steam Engine            | 695  | Steam Engine Overlay.PNG                  |
| Steam Engine cab        | 696  | Steam Engine Cab Interior Overlay.PNG     |
| Steam Engine roof       | 697  | Steam Engine Roof Overlay.PNG             |

## What's NOT in the VASSAL data
- Walls, doors, windows — not encoded (printed on board images only)
- Per-hex terrain types or movement costs
- LOS-blocking data
- Building interior structure beyond overlay images
- Hex adjacency or connectivity data
