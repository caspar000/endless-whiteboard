"""Writes director.yaml, the game director curriculum, from the lists below.

Source: "A game director's self-education" (docs.darkroomlab.net/541a35-a-game-director-s-self-education),
plus Mark Brown's "The 100 Games That Taught Me Game Design" (gmtk.substack.com) for the play list
and Ian Schreiber's Game Design Concepts syllabus (gamedesignconcepts.wordpress.com/syllabus) for
the twenty Levels. Run `python3 gen_director.py` here after editing; the YAML is what ships.
"""

import json
import re

OUT = 'director.yaml'


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower().replace('’', '').replace("'", '')).strip('-')


def q(text):
    return json.dumps(text, ensure_ascii=False)


def child(title, medium, core=False, id=None):
    return {'id': id or slug(title), 'title': title, 'medium': medium, 'core': core}


def item(id, title, medium, tags, kind='study', children=(), rule=None):
    return {'id': id, 'title': title, 'kind': kind, 'medium': medium, 'tags': tags, 'children': list(children), 'rule': rule}


# Mark Brown's 100, in his order, as (title, year).
BROWN = [
    ('Space Invaders', 1978), ('Pac-Man', 1980), ('Rogue', 1980), ('Super Mario Bros.', 1985),
    ('The Legend of Zelda', 1986), ('Mega Man', 1987), ('Tetris', 1989), ('DOOM', 1993),
    ('Super Metroid', 1994), ('Pokemon Blue Version', 1996), ('Tomb Raider', 1996), ('Resident Evil', 1996),
    ('Half-Life', 1998), ('Thief: The Dark Project', 1998), ('Crazy Taxi', 1999), ('Deus Ex', 2000),
    ('Diablo II', 2000), ('The Sims', 2000), ('Grand Theft Auto III', 2001), ('Tony Hawk’s Pro Skater 3', 2001),
    ('Ico', 2001), ('Rez', 2001), ('Silent Hill 2', 2001), ('Animal Crossing', 2003),
    ('WarioWare, Inc.: Mega Microgames!', 2003), ('September 12th', 2003), ('Prince of Persia: The Sands of Time', 2003),
    ('Katamari Damacy', 2004), ('Devil May Cry 3: Dante’s Awakening', 2005), ('Resident Evil 4', 2005),
    ('Geometry Wars: Retro Evolved', 2005), ('Dead Rising', 2006), ('Call of Duty 4: Modern Warfare', 2007),
    ('Portal', 2007), ('Mass Effect', 2007), ('Skate', 2007), ('Team Fortress 2', 2007), ('BioShock', 2007),
    ('Burnout Paradise', 2008), ('Far Cry 2', 2008), ('Left 4 Dead', 2008), ('Spelunky', 2008),
    ('Dead Space', 2008), ('Batman: Arkham Asylum', 2009), ('Plants vs. Zombies', 2009), ('Fruit Ninja', 2010),
    ('Amnesia: The Dark Descent', 2010), ('Fallout: New Vegas', 2010), ('Civilization V', 2010),
    ('Dark Souls', 2011), ('Minecraft', 2011), ('SpaceChem', 2011), ('The Elder Scrolls V: Skyrim', 2011),
    ('Journey', 2012), ('Mark of the Ninja', 2012), ('The Walking Dead', 2012),
    ("Zero Escape: Virtue's Last Reward", 2012), ('XCOM: Enemy Unknown', 2012), ('Spec Ops: The Line', 2012),
    ('Spaceteam', 2012), ('Dishonored', 2012), ('The Stanley Parable', 2013), ('Brothers: A Tale of Two Sons', 2013),
    ('Cookie Clicker', 2013), ('Gone Home', 2013), ('Papers, Please', 2013), ('SteamWorld Dig', 2013),
    ('Alien: Isolation', 2014), ('Mario Kart 8', 2014), ('80 Days', 2014), ('Her Story', 2015),
    ('Metal Gear Solid V: The Phantom Pain', 2015), ('Undertale', 2015), ('Downwell', 2015), ('Yakuza 0', 2015),
    ('Kerbal Space Program', 2015), ('Super Mario Maker', 2015), ('DOOM', 2016), ('Factorio', 2016),
    ('Persona 5', 2016), ('Hitman', 2016), ('Overcooked!', 2016), ('Furi', 2016),
    ('The Legend of Zelda: Breath of the Wild', 2017), ('Fortnite', 2017), ('Getting Over It, with Bennett Foddy', 2017),
    ('Middle-Earth: Shadow of War', 2017), ('Among Us', 2018), ('Celeste', 2018), ('Rimworld', 2018),
    ('Florence', 2018), ('Into the Breach', 2018), ('Slay the Spire', 2019), ('Disco Elysium', 2019),
    ('Outer Wilds', 2019), ('Half-Life: Alyx', 2020), ('Inscryption', 2021), ('Vampire Survivors', 2021),
    ('Tunic', 2022), ('Shadows of Doubt', 2023),
]
assert len(BROWN) == 100

# Brown's 100 in chronological clusters, as the curriculum asks: (first year, last year).
CLUSTERS = [(1978, 1989), (1993, 1999), (2000, 2003), (2004, 2007), (2008, 2010), (2011, 2013), (2014, 2016), (2017, 2023)]


def brown_clusters():
    out = []
    for first, last in CLUSTERS:
        games = [(t, y) for t, y in BROWN if first <= y <= last]
        out.append(item(
            f'brown-{first}-{last}', f"Mark Brown's 100: {first}–{last}", 'game', ['play-literacy'],
            children=[child(f'{t} ({y})', 'game', id=f'brown-{slug(t)}-{y}') for t, y in games], rule='all',
        ))
    assert sum(len(c['children']) for c in out) == 100
    return out


# Schreiber, Game Design Concepts: one Level per date of the 2009 syllabus.
LEVELS = [
    'Overview of Games and Design', 'What Is Game Design?', 'Formal Elements of Games',
    'The Game Design Process', 'Mechanics and Dynamics', 'Games and Art', 'Decision-Making and Flow',
    'Kinds of Fun and Player Types', 'Dramatic Elements in Games', 'Nonlinear Storytelling',
    'The Design Project', 'Solo Testing', 'Designer Testing', 'Player Testing', 'Blindtesting',
    'Game Balance', 'User Interface Design', 'User Interface Iteration', 'Critical Analysis of the Projects',
    'Course Summary and Next Steps',
]
assert len(LEVELS) == 20

GAME_DESIGN = [
    # Stage 0, week 1.
    item('game-journal', 'Start One Journal for Games, Films and Books', 'exercise', ['foundations'], kind='practice'),
    # Stage 1, months 1–3.
    item('schreiber-game-design-concepts', 'Schreiber, Game Design Concepts', 'book', ['foundations'],
         children=[child(f'Level {i}: {t}', 'work', id=f'level-{i}') for i, t in enumerate(LEVELS, 1)], rule='all'),
    item('brathwaite-schreiber-challenges', 'Brathwaite & Schreiber, Challenges for Game Designers', 'book', ['foundations']),
    item('koster-theory-of-fun', 'Koster, A Theory of Fun', 'book', ['foundations']),
    item('fullerton-game-design-workshop', 'Fullerton, Game Design Workshop', 'book', ['foundations', 'design-craft'],
         children=[child('Part One: Formal, Dramatic and Dynamic Elements', 'work', core=True, id='fullerton-part-one'),
                   child('The Rest, With Every Exercise', 'work', core=True, id='fullerton-the-rest')], rule='all'),
    item('death-to-the-three-act-structure', 'Abernathy & Rouse, "Death to the Three-Act Structure!" (GDC 2014)', 'talk', ['narrative']),
    item('mcloud-understanding-comics', 'McCloud, Understanding Comics', 'book', ['foundations']),
    # The free MIT course: a syllabus of readings around non-digital games.
    item('mit-cms-608', 'MIT CMS.608 Game Design (Spring 2014)', 'book', ['foundations', 'design-craft'], children=[
        child('Hunicke, LeBlanc & Zubek, "MDA"', 'work', core=True, id='mda'),
        child('Norman, The Design of Everyday Things', 'work', id='norman-design-of-everyday-things'),
        child('Salen & Zimmerman, Rules of Play (Chapters)', 'work', id='rules-of-play-chapters'),
        child('Tabletop: Analog Game Design', 'work', id='tabletop-analog-game-design'),
        child('De Koven, The Well-Played Game', 'work', id='de-koven-well-played-game'),
    ]),
    # Stage 2, months 4–9: one Boss Fight book a month, the game played alongside.
    item('boss-fight-books', 'Boss Fight Books', 'book', ['close-reading'], children=[
        child('Spelunky (Derek Yu)', 'work', core=True, id='bfb-spelunky'),
        child('Shadow of the Colossus', 'work', core=True, id='bfb-shadow-of-the-colossus'),
        child('Outer Wilds', 'work', core=True, id='bfb-outer-wilds'),
        *[child(t, 'work', id=f'bfb-{slug(t)}') for t in [
            'EarthBound', 'Chrono Trigger', 'ZZT', 'Galaga', 'Jagged Alliance 2', "Baldur's Gate II",
            'Metal Gear Solid', "Majora's Mask", 'Silent Hill 2', 'Katamari Damacy', 'Day of the Tentacle',
            'Untitled Goose Game']],
    ]),
    item('well-played', 'Well Played (ETC Press)', 'book', ['close-reading']),
    item('payne-huntemann-how-to-play-video-games', 'Payne & Huntemann, How to Play Video Games', 'book', ['close-reading']),
    # Tier 2: theory, no sequence.
    item('schell-art-of-game-design', 'Schell, The Art of Game Design', 'book', ['design-craft']),
    item('salen-zimmerman-rules-of-play', 'Salen & Zimmerman, Rules of Play', 'book', ['design-craft']),
    # Narrative design, folded in.
    item('narrative-structure', 'Structure: McKee and Mackendrick', 'book', ['narrative'], children=[
        child('McKee, Story', 'work', core=True, id='mckee-story'),
        child('Mackendrick, "Dramatic Construction"', 'work', core=True, id='mackendrick-dramatic-construction'),
    ], rule='all'),
    item('aristotle-poetics', 'Aristotle, Poetics', 'book', ['narrative']),
    item('prose-craft', 'Prose Craft: Le Guin or Saunders', 'book', ['narrative'], children=[
        child('Le Guin, Steering the Craft', 'work', id='le-guin-steering-the-craft'),
        child('Saunders, A Swim in a Pond in the Rain', 'work', id='saunders-swim-in-a-pond'),
    ], rule='n:1'),
    item('game-narrative', 'Game-Specific Narrative', 'book', ['narrative'], children=[
        child('Murray, Hamlet on the Holodeck', 'work', id='murray-hamlet-on-the-holodeck'),
        child('Short & Adams, Procedural Storytelling', 'work', id='short-adams-procedural-storytelling'),
        child("Emily Short's Blog", 'work', id='emily-short-blog'),
        child("Inkle's Talks", 'talk', id='inkle-talks'),
    ]),
    # Stage 3, ongoing: the play list, checked against the museum's.
    *brown_clusters(),
    item('moma-first-14', "MoMA's First 14 (2012)", 'game', ['play-literacy'], children=[
        child(t, 'game', id=f'moma-{slug(t)}') for t in [
            'Pac-Man', 'Tetris', 'Another World', 'Myst', 'SimCity 2000', 'vib-ribbon', 'The Sims',
            'Katamari Damacy', 'EVE Online', 'Dwarf Fortress', 'Portal', 'flOw', 'Passage', 'Canabalt']
    ], rule='all'),
    item('kojima-creative-gene', 'Kojima, The Creative Gene', 'book', ['directors-intake']),
    # Electives: read when a specific problem comes up.
    item('electives', 'Electives', 'book', ['design-craft'], children=[
        child('Swink, Game Feel', 'work', id='swink-game-feel'),
        child('Sylvester, Designing Games', 'work', id='sylvester-designing-games'),
        child('Anthropy & Clark, A Game Design Vocabulary', 'work', id='anthropy-clark-vocabulary'),
        child('Lantz, The Beauty of Games', 'work', id='lantz-beauty-of-games'),
        child('Rogers, Level Up!', 'work', id='rogers-level-up'),
    ]),
]

TRACKS = [
    ('game-design', 'Game Design', GAME_DESIGN),
]


def write():
    ids = set()
    lines = [
        '# A game director\'s self-education: the curriculum page\'s tracks, as one goal.',
        '# Generated by gen_director.py from the lists in it; edit those and run it again.',
        '# Import with "Import the game director curriculum", or drop the file on a board.',
        'goal: director',
        'name: Game director',
        '',
        'tracks:',
    ]
    for track_id, name, items in TRACKS:
        lines += [f'  - id: {track_id}', f'    name: {q(name)}', '    state: active', '    items:']
        for it in items:
            for key in [it['id'], *(c['id'] for c in it['children'])]:
                assert key not in ids, key
                ids.add(key)
            lines += [
                f'      - id: {it["id"]}',
                f'        title: {q(it["title"])}',
                f'        kind: {it["kind"]}',
                f'        medium: {it["medium"]}',
                f'        tags: [{", ".join(it["tags"])}]',
            ]
            if it['rule']:
                lines.append(f'        childRule: {q(it["rule"]) if ":" in it["rule"] else it["rule"]}')
            if it['children']:
                lines.append('        children:')
                for c in it['children']:
                    core = ', core: true' if c['core'] else ''
                    lines.append(f'          - {{ id: {c["id"]}, title: {q(c["title"])}, medium: {c["medium"]}{core} }}')
    open(OUT, 'w').write('\n'.join(lines) + '\n')
    print(f'{OUT}: {len(ids)} items')


write()
