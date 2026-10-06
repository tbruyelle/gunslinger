package gunslinger

import (
	"strconv"
	"strings"
	"time"

	"gno.land/p/tbruyelle/gunslinger/engine/v0"
)

// JSON views for the web client, read through Render("json/...") so the
// string comes back raw from vm/qrender. Built by hand: the shapes are fixed
// and small, and the chain has no encoding/json.

const listLimit = 50

// GameJSON is the full view of a game:
//
//	{"id","rev","phase","turn","maxTurns","timeout" (seconds),"board",
//	 "players":[{"addr","char","hex","facing","down","delay","status","submitted","playedFoot","playedRun","ranLastTurn",
//	             "aim","aimHex" (the hex the AIM markers sit on, "" when on the opponent),"endurance","serious","gunArm","otherArm","leg",
//	             "guns":[{"id","type","name","location","cocked","shells","capacity","jammed","exploded"}]}],
//	 "ground":[{"hex","guns":[{..}]}],
//	 "winner","endReason","createdAt","updatedAt","timeoutAt",
//	 "lastTurn":null|{"turn","seed","cards":[result card numbers drawn, in order],"plans":[..],
//	             "events":[{"seg","p","kind","action","from","to","facing","down","n","delay","reason","card","result","endurance","target","hit","range","gun","gunId"}],
//	             "start":[{"hex","facing","down","delay","status","aim","aimHex","endurance","serious","gunArm","otherArm","leg","guns":[..]},..]}}
//
// Times are unix seconds; winner and events[].p are seat indexes, -1 for none.
// The plans of the turn in progress are not exposed, only the submitted flags.
func GameJSON(id string) string {
	g := getGame(id)
	var b strings.Builder
	b.WriteString(`{"id":` + quote(g.ID))
	b.WriteString(`,"rev":` + strconv.Itoa(g.Rev))
	b.WriteString(`,"phase":` + quote(g.Phase.String()))
	b.WriteString(`,"turn":` + strconv.Itoa(g.Turn))
	b.WriteString(`,"maxTurns":` + strconv.Itoa(g.MaxTurns))
	b.WriteString(`,"timeout":` + strconv.FormatInt(int64(g.Timeout/time.Second), 10))
	b.WriteString(`,"board":"A"`)
	b.WriteString(`,"players":[`)
	for i := range g.Players {
		if i > 0 {
			b.WriteByte(',')
		}
		writePlayer(&b, g, i)
	}
	b.WriteByte(']')
	writeGround(&b, g.State.Ground)
	b.WriteString(`,"winner":` + strconv.Itoa(g.Winner))
	b.WriteString(`,"endReason":` + quote(g.EndReason))
	b.WriteString(`,"createdAt":` + strconv.FormatInt(g.CreatedAt.Unix(), 10))
	b.WriteString(`,"updatedAt":` + strconv.FormatInt(g.UpdatedAt.Unix(), 10))
	timeoutAt := int64(0)
	if g.Phase != PhaseFinished {
		timeoutAt = g.timeoutAt().Unix()
	}
	b.WriteString(`,"timeoutAt":` + strconv.FormatInt(timeoutAt, 10))
	b.WriteString(`,"lastTurn":`)
	writeTurnResult(&b, g.lastTurn())
	b.WriteByte('}')
	return b.String()
}

// HistoryJSON is every resolved turn of a game, oldest first, for replays:
//
//	{"id","turn","phase","players":[{"addr","char"}],"turns":[turn result...]}
func HistoryJSON(id string) string {
	g := getGame(id)
	var b strings.Builder
	b.WriteString(`{"id":` + quote(g.ID))
	b.WriteString(`,"turn":` + strconv.Itoa(g.Turn))
	b.WriteString(`,"phase":` + quote(g.Phase.String()))
	b.WriteString(`,"players":[`)
	for i, p := range g.Players {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"addr":` + quote(p.Addr.String()) + `,"char":` + quote(p.Char) + `}`)
	}
	b.WriteString(`],"turns":[`)
	for i, r := range g.Turns {
		if i > 0 {
			b.WriteByte(',')
		}
		writeTurnResult(&b, r)
	}
	b.WriteString("]}")
	return b.String()
}

func writePlayer(b *strings.Builder, g *Game, i int) {
	p, c := g.Players[i], g.State.Chars[i]
	b.WriteString(`{"addr":` + quote(p.Addr.String()))
	b.WriteString(`,"char":` + quote(p.Char))
	b.WriteString(`,"hex":` + quote(c.Hex))
	b.WriteString(`,"facing":` + strconv.Itoa(int(c.Facing)))
	b.WriteString(`,"down":` + strconv.FormatBool(c.Down))
	b.WriteString(`,"delay":` + strconv.Itoa(c.Delay))
	b.WriteString(`,"status":` + quote(c.Status.String()))
	b.WriteString(`,"submitted":` + strconv.FormatBool(g.Submitted[i]))
	b.WriteString(`,"playedFoot":` + strconv.FormatBool(c.PlayedFoot))
	b.WriteString(`,"playedRun":` + strconv.FormatBool(c.PlayedRun))
	b.WriteString(`,"ranLastTurn":` + strconv.FormatBool(c.RanLastTurn))
	writeWounds(b, c)
	writeGuns(b, c.Guns)
	b.WriteByte('}')
}

// writeWounds writes the aim and wound members of a character.
func writeWounds(b *strings.Builder, c engine.Character) {
	b.WriteString(`,"aim":` + strconv.Itoa(c.Aim))
	b.WriteString(`,"aimHex":` + quote(c.AimHex))
	b.WriteString(`,"endurance":` + strconv.Itoa(c.Endurance))
	b.WriteString(`,"serious":` + strconv.Itoa(c.Serious))
	b.WriteString(`,"gunArm":` + strconv.Itoa(c.GunArm))
	b.WriteString(`,"otherArm":` + strconv.Itoa(c.OtherArm))
	b.WriteString(`,"leg":` + strconv.Itoa(c.Leg))
}

// writeGround writes the ,"ground":[...] member: the weapons lying in hexes.
func writeGround(b *strings.Builder, ground []engine.GroundGun) {
	b.WriteString(`,"ground":[`)
	for i, gg := range ground {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"hex":` + quote(gg.Hex))
		writeGuns(b, engine.Guns{gg.Gun})
		b.WriteByte('}')
	}
	b.WriteByte(']')
}

// writeGuns writes the ,"guns":[...] member of a character.
func writeGuns(b *strings.Builder, guns engine.Guns) {
	b.WriteString(`,"guns":[`)
	n := 0
	for _, g := range guns {
		if g.Type == engine.NoGun {
			continue
		}
		if n > 0 {
			b.WriteByte(',')
		}
		n++
		spec := g.Type.Spec()
		b.WriteString(`{"id":` + strconv.Itoa(g.ID))
		b.WriteString(`,"type":` + quote(string(g.Type)))
		b.WriteString(`,"name":` + quote(spec.Name))
		b.WriteString(`,"location":` + quote(g.Location.String()))
		b.WriteString(`,"cocked":` + strconv.FormatBool(g.Cocked))
		b.WriteString(`,"shells":` + strconv.Itoa(g.Shells))
		b.WriteString(`,"capacity":` + strconv.Itoa(spec.Capacity))
		b.WriteString(`,"jammed":` + strconv.FormatBool(g.Jammed))
		b.WriteString(`,"exploded":` + strconv.FormatBool(g.Exploded))
		b.WriteByte('}')
	}
	b.WriteByte(']')
}

func writeTurnResult(b *strings.Builder, r *TurnResult) {
	if r == nil {
		b.WriteString("null")
		return
	}
	b.WriteString(`{"turn":` + strconv.Itoa(r.Turn))
	b.WriteString(`,"seed":` + quote(r.Seed))
	b.WriteString(`,"cards":[`)
	for i, n := range r.Cards {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.Itoa(n))
	}
	b.WriteString(`],"plans":[`)
	for i, p := range r.Plans {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(quote(p))
	}
	b.WriteString(`],"events":[`)
	for i, e := range r.Events {
		if i > 0 {
			b.WriteByte(',')
		}
		writeEvent(b, e)
	}
	b.WriteString(`],"start":[`)
	for i, c := range r.Start {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"hex":` + quote(c.Hex))
		b.WriteString(`,"facing":` + strconv.Itoa(int(c.Facing)))
		b.WriteString(`,"down":` + strconv.FormatBool(c.Down))
		b.WriteString(`,"delay":` + strconv.Itoa(c.Delay))
		b.WriteString(`,"status":` + quote(c.Status.String()))
		writeWounds(b, c)
		writeGuns(b, c.Guns)
		b.WriteByte('}')
	}
	b.WriteString("]}")
}

func writeEvent(b *strings.Builder, e engine.Event) {
	b.WriteString(`{"seg":` + strconv.Itoa(e.Seg))
	b.WriteString(`,"p":` + strconv.Itoa(e.Player))
	b.WriteString(`,"kind":` + quote(e.Kind))
	b.WriteString(`,"action":` + quote(string(e.Action)))
	b.WriteString(`,"from":` + quote(e.From))
	b.WriteString(`,"to":` + quote(e.To))
	b.WriteString(`,"facing":` + strconv.Itoa(int(e.Facing)))
	b.WriteString(`,"down":` + strconv.FormatBool(e.Down))
	b.WriteString(`,"n":` + strconv.Itoa(e.N))
	b.WriteString(`,"delay":` + strconv.Itoa(e.Delay))
	b.WriteString(`,"reason":` + quote(e.Reason))
	b.WriteString(`,"card":` + strconv.Itoa(e.Card))
	b.WriteString(`,"result":` + quote(e.Result))
	b.WriteString(`,"endurance":` + strconv.Itoa(e.Endurance))
	b.WriteString(`,"target":` + strconv.Itoa(e.Target))
	b.WriteString(`,"hit":` + quote(e.Hit))
	b.WriteString(`,"range":` + strconv.Itoa(e.Range))
	b.WriteString(`,"gun":` + quote(string(e.Gun)))
	b.WriteString(`,"gunId":` + strconv.Itoa(e.GunID))
	b.WriteByte('}')
}

// GamesJSON lists, for an address, the games waiting for an opponent and
// the games it plays or played, newest first (at most 50 each):
//
//	{"open":[summary...],"mine":[summary...]}
//	summary = {"id","rev","phase","turn","maxTurns","timeout","winner","endReason","createdAt","updatedAt","players":[{"addr","char"}]}
func GamesJSON(addr string) string {
	var b strings.Builder
	b.WriteString(`{"open":[`)
	n := 0
	openGames.ReverseIterate("", "", func(_ string, v any) bool {
		if n > 0 {
			b.WriteByte(',')
		}
		writeSummary(&b, v.(*Game))
		n++
		return n >= listLimit
	})
	b.WriteString(`],"mine":[`)
	if v := byPlayer.Get(addr); v != nil {
		for i, id := range v.([]string) {
			if i >= listLimit {
				break
			}
			if i > 0 {
				b.WriteByte(',')
			}
			writeSummary(&b, games.Get(id).(*Game))
		}
	}
	b.WriteString("]}")
	return b.String()
}

func writeSummary(b *strings.Builder, g *Game) {
	b.WriteString(`{"id":` + quote(g.ID))
	b.WriteString(`,"rev":` + strconv.Itoa(g.Rev))
	b.WriteString(`,"phase":` + quote(g.Phase.String()))
	b.WriteString(`,"turn":` + strconv.Itoa(g.Turn))
	b.WriteString(`,"maxTurns":` + strconv.Itoa(g.MaxTurns))
	b.WriteString(`,"timeout":` + strconv.FormatInt(int64(g.Timeout/time.Second), 10))
	b.WriteString(`,"winner":` + strconv.Itoa(g.Winner))
	b.WriteString(`,"endReason":` + quote(g.EndReason))
	b.WriteString(`,"createdAt":` + strconv.FormatInt(g.CreatedAt.Unix(), 10))
	b.WriteString(`,"updatedAt":` + strconv.FormatInt(g.UpdatedAt.Unix(), 10))
	b.WriteString(`,"players":[`)
	for i, p := range g.Players {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`{"addr":` + quote(p.Addr.String()) + `,"char":` + quote(p.Char) + `}`)
	}
	b.WriteString("]}")
}

// quote encodes s as a JSON string.
func quote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"' || c == '\\':
			b.WriteByte('\\')
			b.WriteByte(c)
		case c == '\n':
			b.WriteString(`\n`)
		case c == '\r':
			b.WriteString(`\r`)
		case c == '\t':
			b.WriteString(`\t`)
		case c < 0x20:
			b.WriteString(`\u00`)
			b.WriteByte("0123456789abcdef"[c>>4])
			b.WriteByte("0123456789abcdef"[c&0xf])
		default:
			b.WriteByte(c)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// GameRev is the cheapest way to poll a game for changes.
func GameRev(id string) int { return getGame(id).Rev }
