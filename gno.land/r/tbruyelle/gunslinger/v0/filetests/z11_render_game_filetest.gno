// PKGPATH: gno.land/r/tbruyelle/gunslinger/v0/filetests/z11_render_game_filetest

package z11_render_game_filetest

import (
	"testing"

	gunslinger "gno.land/r/tbruyelle/gunslinger/v0"
)

const (
	alice address = "g1alice00000000000000000000000000000000"
	bob   address = "g1bob0000000000000000000000000000000000"
	carol address = "g1carol0000000000000000000000000000000"
)

// The gnoweb pages after a resolved turn.
func main(cur realm) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := gunslinger.CreateGame(cross(cur), "marshal", 10)
	testing.SetRealm(testing.NewUserRealm(bob))
	gunslinger.JoinGame(cross(cur), id, "dude")
	testing.SetRealm(testing.NewUserRealm(alice))
	gunslinger.SubmitPlan(cross(cur), id, "1f:ahead_left,2f:ahead,3f")
	testing.SetRealm(testing.NewUserRealm(bob))
	gunslinger.SubmitPlan(cross(cur), id, "4b,1f:ahead")
	println(gunslinger.Render(""))
	println(gunslinger.Render("game/" + id))
}

// Output:
// # Gunslinger
// Two-player showdowns on board A, the Corral. Create a game, wait for an opponent, then submit a plan every turn. [How to play](/r/tbruyelle/gunslinger/v0:help).
//
// [Create a game as the marshal]($help&func=CreateGame&charKey=marshal&maxTurns=10)
//
// ## Open games
// No game is waiting for an opponent.
//
// ## Recent games
// | Game | Players | Turn | Phase |
// |---|---|---|---|
// | [0000001](/r/tbruyelle/gunslinger/v0:game/0000001) | marshal vs dude | 2/10 | planning |
//
//
// # Game 0000001
// Turn 2 of 10 · planning
//
// | Seat | Player | Character | Hex | Facing | Down | Delay | Status | Plan |
// |---|---|---|---|---|---|---|---|---|
// | 0 | `g1alice00000000000000000000000000000000` | marshal | A-G6 | S | no | 0 | alive | pending |
// | 1 | `g1bob0000000000000000000000000000000000` | dude | A-F9 | N | yes | 1 | alive | pending |
//
// ### Turn 1
// Plans: `1f:ahead_left,2f:ahead,3f` vs `4b,1f:ahead`
//
// - seg 1: dude goes down
// - seg 1: dude gains 3 delay (leap), now 3
// - seg 2: marshal advance: A-F3 → A-G4
// - seg 3: marshal run: A-G4 → A-G5
// - seg 4: marshal sprint: A-G5 → A-G6
// - seg 4: marshal gains 1 delay (sprint), now 1
// - end of turn: dude: advance is cancelled (time)
//
// [Submit a plan]($help&func=SubmitPlan&id=0000001&plan=) · [Resign]($help&func=Resign&id=0000001) · [Claim timeout]($help&func=ClaimTimeout&id=0000001) (after 2009-02-14 00:01 UTC)
//
// [Back to the lobby](/r/tbruyelle/gunslinger/v0:)
