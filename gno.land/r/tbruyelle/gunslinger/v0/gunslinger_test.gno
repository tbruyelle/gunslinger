package gunslinger

import (
	"gno.land/p/tbruyelle/gunslinger/engine/v0"
	"strings"
	"testing"

	"gno.land/p/nt/testutils/v0"
	"gno.land/p/nt/uassert/v0"
)

var (
	alice = testutils.TestAddress("alice")
	bob   = testutils.TestAddress("bob")
	carol = testutils.TestAddress("carol")
)

func TestCreateAndJoin(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := CreateGame(cross(cur), "marshal", 0, 0)
	g := getGame(id)
	uassert.Equal(t, "waiting", g.Phase.String())
	uassert.Equal(t, DefaultMaxTurns, g.MaxTurns)
	uassert.Equal(t, int64(DefaultTimeout), int64(g.Timeout))
	uassert.Equal(t, 1, g.Turn)
	uassert.Equal(t, 1, g.Rev)
	uassert.Equal(t, -1, g.Winner)
	uassert.Equal(t, alice.String(), g.Players[0].Addr.String())
	uassert.Equal(t, "marshal", g.Players[0].Char)
	uassert.Equal(t, "", g.Players[1].Addr.String())
	uassert.True(t, openGames.Has(id))
	uassert.Equal(t, "A-F3", g.State.Chars[0].Hex)
	uassert.Equal(t, "A-F9", g.State.Chars[1].Hex)

	js := GameJSON(id)
	uassert.True(t, strings.Contains(js, `"id":"`+id+`"`), js)
	uassert.True(t, strings.Contains(js, `"phase":"waiting"`), js)
	uassert.True(t, strings.Contains(js, `"hex":"A-F3","facing":3,"down":false,"delay":0,"status":"alive","submitted":false`), js)
	uassert.True(t, strings.Contains(js, `"lastTurn":null}`), js)
	uassert.True(t, strings.Contains(js, `"guns":[{"id":1,"type":"colt45","name":"Colt 45","location":"holstered","cocked":false,"shells":6,"capacity":6,"jammed":false,"exploded":false}]`), js)

	uassert.AbortsWithMessage(t, cur, "gunslinger: you cannot join your own game", func() {
		JoinGame(cross(cur), id, "dude")
	})

	testing.SetRealm(testing.NewUserRealm(bob))
	uassert.AbortsWithMessage(t, cur, "gunslinger: unknown character nobody", func() {
		JoinGame(cross(cur), id, "nobody")
	})
	JoinGame(cross(cur), id, "dude")
	uassert.Equal(t, "planning", g.Phase.String())
	uassert.Equal(t, 2, g.Rev)
	uassert.Equal(t, bob.String(), g.Players[1].Addr.String())
	uassert.False(t, openGames.Has(id))

	testing.SetRealm(testing.NewUserRealm(carol))
	uassert.AbortsWithMessage(t, cur, "gunslinger: game is not open", func() {
		JoinGame(cross(cur), id, "dude")
	})

	// Both players find the game in their list; carol has none.
	uassert.True(t, strings.Contains(GamesJSON(alice.String()), `"mine":[{"id":"`+id+`"`))
	uassert.True(t, strings.Contains(GamesJSON(bob.String()), `"mine":[{"id":"`+id+`"`))
	uassert.True(t, strings.HasSuffix(GamesJSON(carol.String()), `"mine":[]}`))
}

func TestCreateValidation(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(alice))
	uassert.AbortsWithMessage(t, cur, "gunslinger: unknown character bogus", func() {
		CreateGame(cross(cur), "bogus", 10, 0)
	})
	uassert.AbortsWithMessage(t, cur, "gunslinger: maxTurns must be between 1 and 50", func() {
		CreateGame(cross(cur), "marshal", 51, 0)
	})
	uassert.AbortsWithMessage(t, cur, "gunslinger: timeoutMinutes must be between 5 and 43200", func() {
		CreateGame(cross(cur), "marshal", 10, 43201)
	})
	uassert.AbortsWithMessage(t, cur, "gunslinger: timeoutMinutes must be between 5 and 43200", func() {
		CreateGame(cross(cur), "marshal", 10, 4)
	})
	uassert.AbortsWithMessage(t, cur, "gunslinger: game not found", func() {
		JoinGame(cross(cur), "9999999", "dude")
	})
	uassert.AbortsWithMessage(t, cur, "gunslinger: invalid game id", func() {
		JoinGame(cross(cur), "nope", "dude")
	})
}

func TestSubmitAndResolve(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := CreateGame(cross(cur), "marshal", 10, 0)
	testing.SetRealm(testing.NewUserRealm(bob))
	JoinGame(cross(cur), id, "dude")
	g := getGame(id)
	rev := g.Rev

	testing.SetRealm(testing.NewUserRealm(carol))
	uassert.AbortsWithMessage(t, cur, "gunslinger: you are not a player of this game", func() {
		SubmitPlan(cross(cur), id, "1f:ahead")
	})

	testing.SetRealm(testing.NewUserRealm(alice))
	uassert.AbortsWithMessage(t, cur, "gunslinger: you cannot use both sides of a card", func() {
		SubmitPlan(cross(cur), id, "1f:ahead,1b:back")
	})
	uassert.AbortsWithMessage(t, cur, "gunslinger: those actions cost more time points than you have", func() {
		SubmitPlan(cross(cur), id, "1b:back,5b")
	})
	uassert.AbortsWithMessage(t, cur, `gunslinger: invalid action "1x"`, func() {
		SubmitPlan(cross(cur), id, "1x")
	})
	uassert.AbortsWithMessage(t, cur, "gunslinger: that action is not available yet", func() {
		SubmitPlan(cross(cur), id, "8f")
	})

	r := SubmitPlan(cross(cur), id, "1f:ahead,2f:ahead")
	uassert.Equal(t, rev+1, r)
	uassert.True(t, g.Submitted[0])
	uassert.False(t, g.Submitted[1])
	// The plan in progress can be read back by its author (plans are plain on chain).
	uassert.Equal(t, `{"id":"`+id+`","turn":1,"seat":0,"submitted":true,"plan":"1f:ahead,2f:ahead"}`, PlanJSON(id, alice.String()))
	uassert.Equal(t, `{"id":"`+id+`","turn":1,"seat":1,"submitted":false,"plan":""}`, PlanJSON(id, bob.String()))
	uassert.Equal(t, `{"id":"`+id+`","turn":1,"seat":-1,"submitted":false,"plan":""}`, PlanJSON(id, carol.String()))
	uassert.Equal(t, PlanJSON(id, alice.String()), Render("json/plan/"+id+"/"+alice.String()))
	uassert.Equal(t, 1, g.Turn)
	uassert.Equal(t, "1f:ahead,2f:ahead", g.Plans[0])
	uassert.True(t, g.State.Chars[0].PlayedFoot)
	uassert.True(t, g.State.Chars[0].PlayedRun)
	uassert.True(t, strings.Contains(GameJSON(id), `"submitted":true,"playedFoot":true,"playedRun":true`))
	uassert.AbortsWithMessage(t, cur, "gunslinger: plan already submitted for this turn", func() {
		SubmitPlan(cross(cur), id, "")
	})

	// The second plan resolves the turn in the same call.
	testing.SetRealm(testing.NewUserRealm(bob))
	r = SubmitPlan(cross(cur), id, "5b")
	uassert.Equal(t, rev+2, r)
	uassert.Equal(t, rev+2, GameRev(id))
	uassert.Equal(t, 2, g.Turn)
	uassert.Equal(t, "planning", g.Phase.String())
	uassert.False(t, g.Submitted[0])
	uassert.False(t, g.Submitted[1])
	uassert.Equal(t, "", g.Plans[0])
	lt := g.lastTurn()
	if lt == nil {
		t.Fatal("no turn result")
	}
	uassert.Equal(t, 1, len(g.Turns))
	uassert.Equal(t, 1, lt.Turn)
	uassert.Equal(t, "1f:ahead,2f:ahead", lt.Plans[0])
	uassert.Equal(t, "5b", lt.Plans[1])
	uassert.Equal(t, 64, len(lt.Seed))
	uassert.Equal(t, "A-F3", lt.Start()[0].Hex)
	uassert.Equal(t, "A-F9", lt.Start()[1].Hex)
	// Alice advanced F3->F4 on segment 2 and ran F4->F5 on segment 3;
	// Bob dropped on segment 3.
	uassert.Equal(t, 3, len(lt.Events()))
	uassert.Equal(t, "A-F5", g.State.Chars[0].Hex)
	uassert.Equal(t, "A-F9", g.State.Chars[1].Hex)
	uassert.True(t, g.State.Chars[1].Down)
	uassert.False(t, g.State.Chars[0].PlayedFoot) // cleared at end of turn

	js := GameJSON(id)
	uassert.True(t, strings.Contains(js, `"turn":2`), js)
	uassert.True(t, strings.Contains(js, `"lastTurn":{"turn":1,"seed":"`+lt.Seed+`","cards":[],"plans":["1f:ahead,2f:ahead","5b"],"events":[`), js)
	uassert.True(t, strings.Contains(js, `"start":[{"hex":"A-F3","facing":3,"down":false,"delay":0,"status":"alive","aim":0,"aimHex":"","endurance":20,"serious":0,"gunArm":0,"otherArm":0,"leg":0,"guns":[{"id":1,"type":"colt45","name":"Colt 45","location":"holstered","cocked":false,"shells":6,"capacity":6,"jammed":false,"exploded":false}]},{"hex":"A-F9","facing":0,"down":false,"delay":0,"status":"alive","aim":0,"aimHex":"","endurance":20,"serious":0,"gunArm":0,"otherArm":0,"leg":0,"guns":[{"id":1,"type":"colt45","name":"Colt 45","location":"holstered","cocked":false,"shells":6,"capacity":6,"jammed":false,"exploded":false}]}]}}`), js)

	// Alice ran on turn 1, so she may sprint on turn 2; Bob did not.
	uassert.True(t, g.State.Chars[0].RanLastTurn)
	uassert.False(t, g.State.Chars[1].RanLastTurn)
	uassert.True(t, strings.Contains(js, `"playedRun":false,"ranLastTurn":true,"aim":0,"aimHex":"","endurance":20,"serious":0,"gunArm":0,"otherArm":0,"leg":0,"guns":[`), js)
	testing.SetRealm(testing.NewUserRealm(bob))
	uassert.AbortsWithMessage(t, cur, "gunslinger: sprint can only be played after a run on the previous turn", func() {
		SubmitPlan(cross(cur), id, "1f:ahead,2f:ahead,3f")
	})

	// A second turn: the history keeps both, oldest first.
	testing.SetRealm(testing.NewUserRealm(alice))
	SubmitPlan(cross(cur), id, "1f:ahead,2f:ahead,3f")
	testing.SetRealm(testing.NewUserRealm(bob))
	SubmitPlan(cross(cur), id, "5b")
	uassert.Equal(t, 2, len(g.Turns))
	h := HistoryJSON(id)
	uassert.True(t, strings.HasPrefix(h, `{"id":"`+id+`","turn":3,"phase":"planning","players":[`), h)
	uassert.True(t, strings.Contains(h, `"turns":[{"turn":1,`), h)
	uassert.True(t, strings.Contains(h, `},{"turn":2,`), h)
	uassert.True(t, strings.Contains(h, `"start":[{"hex":"A-F5","facing":3,"down":false,"delay":0,"status":"alive","aim":0,"aimHex":"","endurance":20,"serious":0,"gunArm":0,"otherArm":0,"leg":0,"guns":[{"id":1,"type":"colt45","name":"Colt 45","location":"holstered","cocked":false,"shells":6,"capacity":6,"jammed":false,"exploded":false}]},{"hex":"A-F9","facing":0,"down":true,"delay":0,"status":"alive","aim":0,"aimHex":"","endurance":20,"serious":0,"gunArm":0,"otherArm":0,"leg":0,"guns":[{"id":1,"type":"colt45","name":"Colt 45","location":"holstered","cocked":false,"shells":6,"capacity":6,"jammed":false,"exploded":false}]}]}`), h)
	uassert.Equal(t, h, Render("json/history/"+id))
	uassert.True(t, strings.Contains(js, `{"seg":2,"p":0,"kind":"move","action":"advance","from":"A-F3","to":"A-F4","facing":3,"down":false,"n":0,"delay":0,"reason":"","card":0,"result":"","endurance":0,"target":0,"hit":"","range":0,"gun":"","gunId":0}`), js)
	uassert.True(t, strings.Contains(js, `{"seg":3,"p":1,"kind":"flip","action":"get_up_down","from":"","to":"","facing":0,"down":true,"n":0,"delay":0,"reason":"","card":0,"result":"","endurance":0,"target":0,"hit":"","range":0,"gun":"","gunId":0}`), js)
	uassert.True(t, strings.Contains(js, `"hex":"A-F9","facing":0,"down":true`), js)
}

func TestMaxTurnsFinish(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := CreateGame(cross(cur), "marshal", 1, 0)
	testing.SetRealm(testing.NewUserRealm(bob))
	JoinGame(cross(cur), id, "dude")
	testing.SetRealm(testing.NewUserRealm(alice))
	SubmitPlan(cross(cur), id, "")
	testing.SetRealm(testing.NewUserRealm(bob))
	SubmitPlan(cross(cur), id, "3b:ahead_left")
	g := getGame(id)
	uassert.Equal(t, "finished", g.Phase.String())
	uassert.Equal(t, "max_turns", g.EndReason)
	uassert.Equal(t, -1, g.Winner)
	uassert.Equal(t, 1, g.Turn)
	uassert.Equal(t, 5, int(g.State.Chars[1].Facing)) // facing N, turned ahead_left: NW
	uassert.True(t, strings.Contains(GameJSON(id), `"phase":"finished"`))
	uassert.True(t, strings.Contains(GameJSON(id), `"timeoutAt":0`))
	uassert.AbortsWithMessage(t, cur, "gunslinger: game is not accepting plans", func() {
		SubmitPlan(cross(cur), id, "")
	})
	uassert.AbortsWithMessage(t, cur, "gunslinger: game is finished", func() {
		ClaimTimeout(cross(cur), id)
	})
}

func TestResign(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := CreateGame(cross(cur), "marshal", 10, 0)
	testing.SetRealm(testing.NewUserRealm(bob))
	JoinGame(cross(cur), id, "dude")
	testing.SetRealm(testing.NewUserRealm(carol))
	uassert.AbortsWithMessage(t, cur, "gunslinger: you are not a player of this game", func() {
		Resign(cross(cur), id)
	})
	testing.SetRealm(testing.NewUserRealm(bob))
	Resign(cross(cur), id)
	g := getGame(id)
	uassert.Equal(t, "finished", g.Phase.String())
	uassert.Equal(t, "resign", g.EndReason)
	uassert.Equal(t, 0, g.Winner)
	uassert.Equal(t, "out", g.State.Chars[1].Status.String())
	uassert.AbortsWithMessage(t, cur, "gunslinger: game is not in progress", func() {
		Resign(cross(cur), id)
	})
}

func TestCancel(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := CreateGame(cross(cur), "marshal", 10, 0)
	testing.SetRealm(testing.NewUserRealm(bob))
	uassert.AbortsWithMessage(t, cur, "gunslinger: only the creator can cancel the game", func() {
		CancelGame(cross(cur), id)
	})
	testing.SetRealm(testing.NewUserRealm(alice))
	CancelGame(cross(cur), id)
	g := getGame(id)
	uassert.Equal(t, "finished", g.Phase.String())
	uassert.Equal(t, "cancelled", g.EndReason)
	uassert.False(t, openGames.Has(id))
	uassert.AbortsWithMessage(t, cur, "gunslinger: only a game waiting for an opponent can be cancelled", func() {
		CancelGame(cross(cur), id)
	})
	testing.SetRealm(testing.NewUserRealm(bob))
	uassert.AbortsWithMessage(t, cur, "gunslinger: game is not open", func() {
		JoinGame(cross(cur), id, "dude")
	})
}

func TestClaimTimeout(cur realm, t *testing.T) {
	// A waiting game nobody joined is cancelled.
	testing.SetRealm(testing.NewUserRealm(alice))
	id := CreateGame(cross(cur), "marshal", 10, 30)
	uassert.AbortsWithMessage(t, cur, "gunslinger: the game has not timed out yet", func() {
		ClaimTimeout(cross(cur), id)
	})
	testing.SkipHeights(361) // 5s per height: past the 30 minute timeout picked above
	testing.SetRealm(testing.NewUserRealm(carol))
	ClaimTimeout(cross(cur), id)
	g := getGame(id)
	uassert.Equal(t, "expired", g.EndReason)
	uassert.False(t, openGames.Has(id))

	// One plan in: the other player forfeits.
	testing.SetRealm(testing.NewUserRealm(alice))
	id = CreateGame(cross(cur), "marshal", 10, 30)
	testing.SetRealm(testing.NewUserRealm(bob))
	JoinGame(cross(cur), id, "dude")
	testing.SetRealm(testing.NewUserRealm(alice))
	SubmitPlan(cross(cur), id, "")
	testing.SkipHeights(361)
	testing.SetRealm(testing.NewUserRealm(carol))
	ClaimTimeout(cross(cur), id)
	g = getGame(id)
	uassert.Equal(t, "timeout", g.EndReason)
	uassert.Equal(t, 0, g.Winner)
	uassert.Equal(t, "out", g.State.Chars[1].Status.String())

	// No plan in: abandoned.
	testing.SetRealm(testing.NewUserRealm(alice))
	id = CreateGame(cross(cur), "marshal", 10, 30)
	testing.SetRealm(testing.NewUserRealm(bob))
	JoinGame(cross(cur), id, "dude")
	testing.SkipHeights(361)
	ClaimTimeout(cross(cur), id)
	g = getGame(id)
	uassert.Equal(t, "abandoned", g.EndReason)
	uassert.Equal(t, -1, g.Winner)
	uassert.Equal(t, "alive", g.State.Chars[0].Status.String())
}

func TestRender(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := CreateGame(cross(cur), "marshal", 10, 0)
	testing.SetRealm(testing.NewUserRealm(bob))
	JoinGame(cross(cur), id, "dude")
	home := Render("")
	uassert.True(t, strings.Contains(home, "# Gunslinger"), home)
	uassert.True(t, strings.Contains(home, "/r/tbruyelle/gunslinger/v0:game/"+id), home)
	uassert.True(t, strings.Contains(home, "marshal vs dude"), home)

	page := Render("game/" + id)
	uassert.True(t, strings.Contains(page, "# Game "+id), page)
	uassert.True(t, strings.Contains(page, "| A-F3 | S |"), page)
	uassert.True(t, strings.Contains(page, "planning"), page)
	uassert.True(t, strings.Contains(page, "func=SubmitPlan"), page)

	testing.SetRealm(testing.NewUserRealm(alice))
	SubmitPlan(cross(cur), id, "1f:ahead")
	testing.SetRealm(testing.NewUserRealm(bob))
	SubmitPlan(cross(cur), id, "1f:ahead")
	page = Render("game/" + id)
	uassert.True(t, strings.Contains(page, "seg 2: marshal advance: A-F3 → A-F4"), page)
	uassert.True(t, strings.Contains(page, "seg 2: dude advance: A-F9 → A-F8"), page)

	help := Render("help")
	uassert.True(t, strings.Contains(help, "1f:ahead_left,2f:ahead,3f"), help)
	uassert.True(t, strings.Contains(help, "| 1 | Advance (2) | Back Up (3) |"), help)

	uassert.Equal(t, GameJSON(id), Render("json/game/"+id))
	uassert.Equal(t, GamesJSON(alice.String()), Render("json/games/"+alice.String()))
}

func TestDrawAndCock(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := CreateGame(cross(cur), "marshal", 10, 0)
	testing.SetRealm(testing.NewUserRealm(bob))
	JoinGame(cross(cur), id, "dude")
	testing.SetRealm(testing.NewUserRealm(alice))
	uassert.AbortsWithMessage(t, cur, "gunslinger: that gun is not in a holster", func() {
		SubmitPlan(cross(cur), id, "9f:2:0")
	})
	SubmitPlan(cross(cur), id, "9f:1:0")
	testing.SetRealm(testing.NewUserRealm(bob))
	SubmitPlan(cross(cur), id, "")
	g := getGame(id)
	gun := g.State.Chars[0].Guns[0]
	uassert.Equal(t, "gun_hand", gun.Location.String())
	uassert.True(t, gun.Cocked)
	js := GameJSON(id)
	uassert.True(t, strings.Contains(js, `"location":"gun_hand","cocked":true,"shells":6`), js)
	uassert.True(t, strings.Contains(js, `{"seg":3,"p":0,"kind":"draw","action":"draw_and_cock","from":"holstered","to":"gun_hand","facing":0,"down":false,"n":0,"delay":0,"reason":"","card":0,"result":"","endurance":0,"target":0,"hit":"","range":0,"gun":"colt45","gunId":1}`), js)
	// Drawing again: nothing left in the holster.
	testing.SetRealm(testing.NewUserRealm(alice))
	uassert.AbortsWithMessage(t, cur, "gunslinger: that gun is not in a holster", func() {
		SubmitPlan(cross(cur), id, "9f:1:0")
	})
}

func TestShootout(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := CreateGame(cross(cur), "marshal", 10, 0)
	testing.SetRealm(testing.NewUserRealm(bob))
	JoinGame(cross(cur), id, "dude")
	g := getGame(id)

	// Turn 1: both draw and cock. Turn 2: alice aims twice (4 AIM points).
	testing.SetRealm(testing.NewUserRealm(alice))
	SubmitPlan(cross(cur), id, "9f:1:0")
	testing.SetRealm(testing.NewUserRealm(bob))
	SubmitPlan(cross(cur), id, "9f:1:0")
	testing.SetRealm(testing.NewUserRealm(alice))
	SubmitPlan(cross(cur), id, "5f:aim:@1,6f:aim:@1")
	testing.SetRealm(testing.NewUserRealm(bob))
	SubmitPlan(cross(cur), id, "")
	uassert.Equal(t, 4, g.State.Chars[0].Aim)
	uassert.True(t, g.State.Chars[0].Guns[0].Cocked)
	js := GameJSON(id)
	uassert.True(t, strings.Contains(js, `"ranLastTurn":false,"aim":4,"aimHex":"","endurance":20,"serious":0,"gunArm":0,"otherArm":0,"leg":0,"guns":[{"id":1,"type":"colt45","name":"Colt 45","location":"gun_hand","cocked":true,"shells":6,"capacity":6,"jammed":false,"exploded":false}]`), js)
	uassert.True(t, strings.Contains(js, `"ground":[]`), js)

	// Turn 3: alice shoots (aim time 1 + 4 = 5, range 6); bob does nothing with his gun.
	testing.SetRealm(testing.NewUserRealm(alice))
	SubmitPlan(cross(cur), id, "7f:shoot:@1")
	testing.SetRealm(testing.NewUserRealm(bob))
	SubmitPlan(cross(cur), id, "7f")
	lt := g.lastTurn()
	var shot *engine.Event
	evs := lt.Events()
	for i := range evs {
		if evs[i].Kind == engine.EvShot {
			shot = &evs[i]
		}
	}
	if shot == nil {
		t.Fatalf("no shot event: %v", evs)
	}
	uassert.Equal(t, 0, shot.Player)
	uassert.Equal(t, 1, shot.Target)
	uassert.Equal(t, 6, shot.Range)
	uassert.Equal(t, 1, shot.Seg)
	if shot.Reason != engine.ReasonMisfire {
		uassert.Equal(t, 5, shot.N)
	}
	uassert.Equal(t, 0, g.State.Chars[0].Aim)
	uassert.False(t, g.State.Chars[0].Guns[0].Cocked)
	uassert.True(t, g.State.Chars[0].Guns[0].Shells <= 5)
	uassert.True(t, len(lt.Cards()) >= 1)
	uassert.True(t, strings.Contains(GameJSON(id), `"kind":"shot"`))
	uassert.True(t, strings.Contains(Render("game/"+id), "shoots dude in A-F9 (card "))
}

func TestAutoPass(cur realm, t *testing.T) {
	testing.SetRealm(testing.NewUserRealm(alice))
	id := CreateGame(cross(cur), "marshal", 10, 0)
	testing.SetRealm(testing.NewUserRealm(bob))
	JoinGame(cross(cur), id, "dude")
	g := getGame(id)
	// Alice carries 5 delay: she cannot play anything, so bob's plan alone
	// resolves the turn; her pass is recorded as an empty plan.
	g.State.Chars[0].Delay = 5
	g.State.Chars[0].PlayedFoot = true
	SubmitPlan(cross(cur), id, "1f:ahead")
	uassert.Equal(t, 2, g.Turn)
	lt := g.lastTurn()
	uassert.Equal(t, "", lt.Plans[0])
	uassert.Equal(t, "1f:ahead", lt.Plans[1])
	uassert.False(t, lt.Start()[0].PlayedFoot)
	uassert.Equal(t, 2, g.State.Chars[0].Delay) // 5 -> 2: she can play 3 points now
	uassert.False(t, g.Submitted[0])
	uassert.False(t, g.Submitted[1])
	// Both unable to act: the turns resolve by themselves until someone can play.
	g.State.Chars[0].Delay = 6
	g.State.Chars[1].Delay = 5
	autoPass(g)
	uassert.Equal(t, 3, g.Turn)
	uassert.Equal(t, 3, g.State.Chars[0].Delay) // 6 -> 3
	uassert.Equal(t, 2, g.State.Chars[1].Delay) // 5 -> 2
	uassert.Equal(t, 2, len(g.Turns))
	uassert.Equal(t, "planning", g.Phase.String())
}
