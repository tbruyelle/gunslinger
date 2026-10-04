package gunslinger

import (
	"strconv"
	"strings"
	"time"

	"gno.land/p/moul/md/v0"
	"gno.land/p/moul/txlink/v0"
	"gno.land/p/nt/markdown/sanitize/v0"
	"gno.land/p/nt/mux/v0"
	"gno.land/p/tbruyelle/gunslinger/cards/v0"
	"gno.land/p/tbruyelle/gunslinger/engine/v0"
	"gno.land/p/tbruyelle/gunslinger/hex/v0"
)

const recentLimit = 20

var router = mux.NewRouter()

func init() {
	router.HandleFunc("", renderHome)
	router.HandleFunc("help", renderHelp)
	router.HandleFunc("game/{id}", renderGame)
	router.HandleFunc("json/game/{id}", func(res *mux.ResponseWriter, req *mux.Request) {
		res.Write(GameJSON(req.GetVar("id")))
	})
	router.HandleFunc("json/games/{addr}", func(res *mux.ResponseWriter, req *mux.Request) {
		res.Write(GamesJSON(req.GetVar("addr")))
	})
	router.HandleFunc("json/history/{id}", func(res *mux.ResponseWriter, req *mux.Request) {
		res.Write(HistoryJSON(req.GetVar("id")))
	})
}

// Render serves the gnoweb pages ("", "help", "game/{id}") and the raw JSON
// views the web client reads ("json/game/{id}", "json/games/{addr}",
// "json/history/{id}").
func Render(path string) string {
	return router.Render(path)
}

// link is a gnoweb link to a sub-path of this realm.
func link(text, path string) string {
	return md.Link(text, strings.TrimPrefix(realmPath, "gno.land")+":"+path)
}

func renderHome(res *mux.ResponseWriter, _ *mux.Request) {
	res.Write(md.H1("Gunslinger"))
	res.Write(md.Paragraph("Two-player showdowns on board A, the Corral. " +
		"Create a game, wait for an opponent, then submit a plan every turn. " +
		link("How to play", "help") + "."))
	res.Write(md.Paragraph(md.Link("Create a game as the marshal", txlink.Call("CreateGame", "charKey", "marshal", "maxTurns", "10", "timeoutMinutes", "0"))))

	res.Write(md.H2("Open games"))
	n := 0
	var b strings.Builder
	b.WriteString("| Game | Creator | Character | Created | |\n|---|---|---|---|---|\n")
	openGames.ReverseIterate("", "", func(_ string, v any) bool {
		g := v.(*Game)
		b.WriteString("| " + link(g.ID, "game/"+g.ID) +
			" | " + addr(g.Players[0].Addr) +
			" | " + sanitize.InlineText(g.Players[0].Char) +
			" | " + when(g.CreatedAt) +
			" | " + md.Link("Join as the dude", txlink.Call("JoinGame", "id", g.ID, "charKey", "dude")) + " |\n")
		n++
		return n >= recentLimit
	})
	if n == 0 {
		res.Write(md.Paragraph("No game is waiting for an opponent."))
	} else {
		res.Write(b.String() + "\n")
	}

	res.Write(md.H2("Recent games"))
	n = 0
	b.Reset()
	b.WriteString("| Game | Players | Turn | Phase |\n|---|---|---|---|\n")
	games.ReverseIterate("", "", func(_ string, v any) bool {
		g := v.(*Game)
		b.WriteString("| " + link(g.ID, "game/"+g.ID) +
			" | " + seatLabel(g, 0) + " vs " + seatLabel(g, 1) +
			" | " + strconv.Itoa(g.Turn) + "/" + strconv.Itoa(g.MaxTurns) +
			" | " + phaseLabel(g) + " |\n")
		n++
		return n >= recentLimit
	})
	if n == 0 {
		res.Write(md.Paragraph("No game yet."))
	} else {
		res.Write(b.String() + "\n")
	}
}

func renderGame(res *mux.ResponseWriter, req *mux.Request) {
	g := getGame(req.GetVar("id"))
	res.Write(md.H1("Game " + g.ID))
	res.Write(md.Paragraph("Turn " + strconv.Itoa(g.Turn) + " of " + strconv.Itoa(g.MaxTurns) + " · " + phaseLabel(g)))

	var b strings.Builder
	b.WriteString("| Seat | Player | Character | Hex | Facing | Down | Delay | Status | Plan |\n")
	b.WriteString("|---|---|---|---|---|---|---|---|---|\n")
	for i, p := range g.Players {
		c := g.State.Chars[i]
		plan := "-"
		if g.Phase == PhasePlanning {
			plan = "pending"
			if g.Submitted[i] {
				plan = "submitted"
			}
		}
		b.WriteString("| " + strconv.Itoa(i) +
			" | " + addr(p.Addr) +
			" | " + sanitize.InlineText(p.Char) +
			" | " + c.Hex +
			" | " + c.Facing.String() +
			" | " + yesNo(c.Down) +
			" | " + strconv.Itoa(c.Delay) +
			" | " + c.Status.String() +
			" | " + plan + " |\n")
	}
	res.Write(b.String() + "\n")

	for _, r := range g.Turns {
		res.Write(md.H3("Turn " + strconv.Itoa(r.Turn)))
		res.Write(md.Paragraph("Plans: " + md.InlineCode(orPass(r.Plans[0])) + " vs " + md.InlineCode(orPass(r.Plans[1]))))
		if len(r.Cards) > 0 {
			cards := make([]string, len(r.Cards))
			for i, n := range r.Cards {
				cards[i] = strconv.Itoa(n)
			}
			res.Write(md.Paragraph("Result cards drawn: " + strings.Join(cards, ", ")))
		}
		items := make([]string, 0, len(r.Events))
		for _, e := range r.Events {
			items = append(items, describeEvent(g, e))
		}
		if len(items) == 0 {
			items = append(items, "Nothing happened.")
		}
		res.Write(md.BulletList(items) + "\n")
	}

	switch g.Phase {
	case PhaseWaiting:
		res.Write(md.Paragraph(md.Link("Join as the dude", txlink.Call("JoinGame", "id", g.ID, "charKey", "dude")) +
			" · " + md.Link("Cancel", txlink.Call("CancelGame", "id", g.ID))))
	case PhasePlanning:
		res.Write(md.Paragraph(md.Link("Submit a plan", txlink.Call("SubmitPlan", "id", g.ID, "plan", "")) +
			" · " + md.Link("Resign", txlink.Call("Resign", "id", g.ID)) +
			" · " + md.Link("Claim timeout", txlink.Call("ClaimTimeout", "id", g.ID)) +
			" (after " + when(g.timeoutAt()) + ")"))
	}
	res.Write(md.Paragraph(link("Back to the lobby", "")))
}

func renderHelp(res *mux.ResponseWriter, _ *mux.Request) {
	res.Write(md.H1("How to play"))
	res.Write(md.Paragraph("Each turn has five segments. Both players secretly pick up to five time points " +
		"of action cards, in the order they will do them, then the turn resolves: an action executes on the " +
		"segment equal to the time points used so far plus its own cost plus the delay points on your sheet. " +
		"Delay you gain during a segment counts from the next one; actions left after segment 5 are cancelled. " +
		"At the end of the turn half of your delay (rounded up) goes away."))
	res.Write(md.H2("Plan string"))
	res.Write(md.Paragraph("A plan is a comma-separated list of card sides in play order, each " +
		md.InlineCode("<card><f|b>[:<direction>]") + ". Directions are relative to your facing: " +
		md.InlineCode("ahead_left") + ", " + md.InlineCode("ahead") + ", " + md.InlineCode("ahead_right") + " for forward moves and turns, " +
		md.InlineCode("back_left") + ", " + md.InlineCode("back") + ", " + md.InlineCode("back_right") + " for backward ones. " +
		"An empty plan passes."))
	res.Write(md.Paragraph("Example: " + md.InlineCode("1f:ahead_left,2f:ahead,3f") + " advances ahead-left, runs ahead, then sprints straight."))
	res.Write(md.Paragraph("Rules: one side per card per turn; the total cost must fit in 5 minus your delay; " +
		"Run needs Advance in the same plan; Sprint needs Run."))
	res.Write(md.H2("Cards"))
	var b strings.Builder
	b.WriteString("| Card | Front | Back |\n|---|---|---|\n")
	for _, c := range cards.Cards {
		b.WriteString("| " + strconv.Itoa(c.Number) + " | " + sideLabel(c.Front) + " | " + sideLabel(c.Back) + " |\n")
	}
	res.Write(b.String() + "\n")
	res.Write(md.Paragraph("Only foot actions are available for now; the others come with guns and brawling."))
}

func sideLabel(s cards.Side) string {
	l := s.Name + " (" + strconv.Itoa(s.Cost) + ")"
	if !cards.Enabled(s.Code) {
		l += " *"
	}
	return l
}

func describeEvent(g *Game, e engine.Event) string {
	who := sanitize.InlineText(g.Players[e.Player].Char)
	seg := "end of turn"
	if e.Seg > 0 {
		seg = "seg " + strconv.Itoa(e.Seg)
	}
	action := strings.ReplaceAll(string(e.Action), "_", " ")
	var what string
	switch e.Kind {
	case engine.EvMove:
		what = who + " " + action + ": " + e.From + " → " + e.To
		if e.Down {
			what += " (crawling)"
		}
	case engine.EvTurn:
		what = who + " " + action + ": now facing " + hex.Dir(e.Facing).String()
	case engine.EvFlip:
		if e.Down {
			what = who + " goes down"
		} else {
			what = who + " gets up"
		}
	case engine.EvDelay:
		what = who + " gains " + strconv.Itoa(e.N) + " delay (" + e.Reason + "), now " + strconv.Itoa(e.Delay)
		if e.Card > 0 {
			card := "card " + strconv.Itoa(e.Card)
			if e.Result == "" {
				what = who + " gains " + strconv.Itoa(e.N) + " delay (" + e.Reason + ", " + card + "), now " + strconv.Itoa(e.Delay)
			} else {
				what = who + " draws " + card + " (" + e.Reason + "): " + strings.ToUpper(strings.ReplaceAll(e.Result, "_", " "))
			}
		}
	case engine.EvWildShot:
		what = who + "'s " + e.Gun.Spec().Name + " goes off (wild shot)"
	case engine.EvCancel:
		what = who + ": " + action + " is cancelled (" + e.Reason + ")"
	default:
		what = who + " " + e.Kind
	}
	return seg + ": " + what
}

func seatLabel(g *Game, i int) string {
	if g.Players[i].Addr == "" {
		return "?"
	}
	return sanitize.InlineText(g.Players[i].Char)
}

func phaseLabel(g *Game) string {
	if g.Phase != PhaseFinished {
		return g.Phase.String()
	}
	l := "finished (" + g.EndReason + ")"
	if g.Winner >= 0 {
		l += ", winner: " + seatLabel(g, g.Winner)
	}
	return l
}

func addr(a address) string {
	return md.InlineCode(sanitize.InlineText(a.String()))
}

func when(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04") + " UTC"
}

func yesNo(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}

func orPass(plan string) string {
	if plan == "" {
		return "(pass)"
	}
	return plan
}
