# How the app should look and feel

Thorne's brief (November 2026): sleek, simple, efficient and fast, in the manner of the big consumer apps; a blend of the best of Skritter and Quizlet; less decoration around the name; personal to where the learner is in the course. v44 rebuilt the shell to this. Keep new screens inside it.

## Principles

1. **One thing to do next.** Today opens on the greeting, where you are in the book, and one filled button. Everything else on that screen is secondary and most of it is folded away.
2. **Content first, chrome quiet.** White surfaces on a light grey page, hairline borders, no shadows, no textures, no hover lift. Colour is reserved for meaning.
3. **Two colours with jobs.** `--brand` is for things you tap: the primary button, links, the active tab, focus. `--acc` (green) means learned or correct. Never use the brand colour for a result, or green for a button.
4. **Plain words.** Sentence case. No letter-spaced capitals. Labels say what the thing is.
5. **Fast.** No full-screen effects, short transitions (160 ms), nothing that re-renders more than its own view.
6. **Book by book.** Always "Book 2 · Lesson 7", never a running lesson number.

## The shell

- **Top bar** (`.mast`): the mark and name on the left; sync status, refresh, day/night and (on wide screens) Settings on the right. It stays in view.
- **Navigation**: phones have a bottom bar of five labelled icons — Today, Review, Drill, 大考試, More — and More opens the rest as a sheet. Tablets and desktop have a text row under the top bar. A new destination gets an entry in `TAB_ICON`.
- **Today**: greeting and date → course chip (opens *Where you are*) → the hero with the one button → exam countdown → two decks (the course lesson, My words) → the three lanes → a fold holding plan, queue and statistics.
- **Sheets**: `shHost()` gives the modal host; build the card with `.sheet-h`, `.frow`, `.myin`, `.seg`. Do not use browser `alert` / `confirm`; use a sheet, or act and offer Undo in a toast.

## Tokens

All colour comes from variables at the top of the stylesheet. Light and dark define the same names; the accent choice (`html[data-accent]`) redefines `--brand`, `--brandInk` (brand-coloured text on the page background) and `--brandT` (its tint). The face study characters are set in is `--cjk`, switched by `html[data-zh]` (sans, 明體, 楷體); interface text uses `--ui` and is always sans.

New styles use the variables and never a literal colour, so they work in dark mode and with every accent.

## What the choices rest on

- **A bottom bar of three to five destinations, each with an icon and a short label.** Material Design's guidance, and the common ground of the secondary sources: [Material bottom navigation](https://material.io/components/bottom-navigation).
- **One primary action on the home screen.** Duolingo's streak moved from a multi-lesson goal to a single lesson a day and stayed the centre of the home screen: [How streaks keep learners committed](https://making.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals).
- **Due count first, then decks with their progress.** Skritter's home screen is a due-cards count above recent decks with progress bars: [Skritter home screen](https://docs.skritter.com/article/231-home-screen). Its forum's standing complaint is the dead end when due cards run out, so every finished state here offers a way to keep going.
- **The same frame around every study mode.** Quizlet's redesign put progress and options in the same place across modes so learners stop re-orienting: [Quizlet's redesign write-up](https://medium.com/tech-quizlet/launching-a-successful-redesign-for-20-million-students-2f4c4b518b6e). The review card, drills and My words share `.stage`, `.grades` and the top progress line.

These are published guidance and product write-ups, not controlled studies. When the app has more than one user, test the Today layout and the fold with real use before trusting them further.
