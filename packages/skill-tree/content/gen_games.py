"""Writes games.yaml, the games tree of the game director's self-education.

The third of the three trees the director curriculum (gen_director.py) is split into, built the way
Adler's is: a skill node is a school of games or a shelf of design books, an entry is a studio or a
designer, its works are the games they made (and the books they wrote). The play list is Mark Brown's
100 (from gen_director.py) and MoMA's first 14, merged and sorted by school, each studio's games in
order. Run `python3 gen_games.py` here after editing; the YAML is what ships.
"""

import json
import re

from gen_director import BROWN, LEVELS

OUT = 'games.yaml'


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower().replace('’', '').replace("'", '')).strip('-')


def q(text):
    return json.dumps(text, ensure_ascii=False)


def work(id, title, medium='game', core=False):
    return {'id': id, 'title': title, 'medium': medium, 'core': core}


def person(id, name, tag, works, medium='game', rule='all', kind='study'):
    """An entry: a person, a pair or a studio, the works under them."""
    return {'id': id, 'title': name, 'kind': kind, 'medium': medium, 'tags': [tag], 'children': works, 'rule': rule}


def single(id, title, tag, medium='book', kind='study'):
    """An entry with no works: a book or a list read whole."""
    return {'id': id, 'title': title, 'kind': kind, 'medium': medium, 'tags': [tag], 'children': [], 'rule': None}


def book(id, title, core=False):
    return work(id, title, 'book', core)


# ---------------------------------------------------------------------------------------------------
# Design: the foundations (Stage 1, months 1–3), the craft shelf, and narrative design.

FOUNDATIONS = [
    person('game-journal', 'Start One Journal for Games, Films and Books', 'foundations', [], 'exercise', None, 'practice'),
    person('schreiber', 'Ian Schreiber', 'foundations', [
        work(f'level-{i}', f'Game Design Concepts, Level {i}: {t}', 'work') for i, t in enumerate(LEVELS, 1)], 'book'),
    person('brathwaite-schreiber', 'Brenda Brathwaite & Ian Schreiber', 'foundations', [book('challenges', 'Challenges for Game Designers')], 'book'),
    person('koster', 'Raph Koster', 'foundations', [book('theory-of-fun', 'A Theory of Fun')], 'book'),
    person('fullerton', 'Tracy Fullerton', 'foundations', [
        book('fullerton-part-one', 'Game Design Workshop, Part One: Formal, Dramatic and Dynamic Elements', True),
        book('fullerton-the-rest', 'Game Design Workshop, the Rest, With Every Exercise', True),
    ], 'book'),
    person('mccloud', 'Scott McCloud', 'foundations', [book('understanding-comics', 'Understanding Comics')], 'book'),
    person('mit-cms-608', 'MIT CMS.608 Game Design (Spring 2014)', 'foundations', [
        work('mda', 'Hunicke, LeBlanc & Zubek, "MDA"', 'work', True),
        work('norman-design-of-everyday-things', 'Norman, The Design of Everyday Things', 'work'),
        work('rules-of-play-chapters', 'Salen & Zimmerman, Rules of Play (Chapters)', 'work'),
        work('tabletop-analog-game-design', 'Tabletop: Analog Game Design', 'work'),
        work('de-koven-well-played-game', 'De Koven, The Well-Played Game', 'work'),
    ], 'book', rule='core'),
]

DESIGN_CRAFT = [
    person('schell', 'Jesse Schell', 'design-craft', [book('art-of-game-design', 'The Art of Game Design')], 'book'),
    person('salen-zimmerman', 'Katie Salen & Eric Zimmerman', 'design-craft', [book('rules-of-play', 'Rules of Play')], 'book'),
    # Electives: read when a specific problem comes up.
    person('swink', 'Steve Swink', 'design-craft', [book('game-feel', 'Game Feel')], 'book'),
    person('anthropy-clark', 'Anna Anthropy & Naomi Clark', 'design-craft', [book('game-design-vocabulary', 'A Game Design Vocabulary')], 'book'),
    person('lantz', 'Frank Lantz', 'design-craft', [book('beauty-of-games', 'The Beauty of Games')], 'book'),
    person('rogers', 'Scott Rogers', 'design-craft', [book('level-up', 'Level Up!')], 'book'),
]

NARRATIVE = [
    person('mckee', 'Robert McKee', 'narrative', [book('story', 'Story', True)], 'book'),
    person('mackendrick', 'Alexander Mackendrick', 'narrative', [book('dramatic-construction', '"Dramatic Construction"', True)], 'book'),
    person('aristotle', 'Aristotle', 'narrative', [book('poetics', 'Poetics')], 'book'),
    person('prose-craft', 'Prose Craft: Le Guin or Saunders', 'narrative', [
        book('steering-the-craft', 'Le Guin, Steering the Craft'),
        book('swim-in-a-pond', 'Saunders, A Swim in a Pond in the Rain'),
    ], 'book', rule='n:1'),
    person('abernathy-rouse', 'Tom Abernathy & Richard Rouse III', 'narrative', [
        work('death-to-the-three-act-structure', '"Death to the Three-Act Structure!" (GDC 2014)', 'talk')], 'talk'),
    person('murray', 'Janet Murray', 'narrative', [book('hamlet-on-the-holodeck', 'Hamlet on the Holodeck')], 'book'),
    person('short-adams', 'Tanya X. Short & Tarn Adams (eds.)', 'narrative', [book('procedural-storytelling', 'Procedural Storytelling in Game Design')], 'book'),
    person('emily-short', 'Emily Short', 'narrative', [work('emily-short-blog', "Emily Short's Interactive Storytelling (blog)", 'work')], 'work'),
    person('inkle', 'inkle', 'narrative', [work('80-days-2014', '80 Days (2014)'), work('inkle-talks', "inkle's Talks", 'talk')]),
]

# ---------------------------------------------------------------------------------------------------
# The play list, by school: (id, studio or designer, school, games as (title, year), books).

MOMA = [
    ('Pac-Man', 1980), ('Tetris', 1989), ('Another World', 1991), ('Myst', 1993), ('SimCity 2000', 1993), ('vib-ribbon', 1999),
    ('The Sims', 2000), ('Katamari Damacy', 2004), ('EVE Online', 2003), ('Dwarf Fortress', 2006), ('Portal', 2007),
    ('flOw', 2006), ('Passage', 2007), ('Canabalt', 2009),
]

MAKERS = [
    # Arcade and score.
    ('nishikado', 'Tomohiro Nishikado (Taito)', 'arcade', [('Space Invaders', 1978)]),
    ('iwatani', 'Toru Iwatani (Namco)', 'arcade', [('Pac-Man', 1980)]),
    ('pajitnov', 'Алексей Пажитнов', 'arcade', [('Tetris', 1989)]),
    ('nanaon-sha', 'Masaya Matsuura (NanaOn-Sha)', 'arcade', [('vib-ribbon', 1999)]),
    ('hitmaker', 'Hitmaker (Sega)', 'arcade', [('Crazy Taxi', 1999)]),
    ('mizuguchi', 'Tetsuya Mizuguchi (United Game Artists)', 'arcade', [('Rez', 2001)]),
    ('bizarre-creations', 'Bizarre Creations', 'arcade', [('Geometry Wars: Retro Evolved', 2005)]),
    ('popcap', 'PopCap Games (George Fan)', 'arcade', [('Plants vs. Zombies', 2009)]),
    ('halfbrick', 'Halfbrick', 'arcade', [('Fruit Ninja', 2010)]),
    ('orteil', 'Orteil', 'arcade', [('Cookie Clicker', 2013)]),
    ('poncle', 'poncle', 'arcade', [('Vampire Survivors', 2021)]),
    # Japanese masters.
    ('miyamoto', 'Shigeru Miyamoto', 'japanese', [('Super Mario Bros.', 1985), ('The Legend of Zelda', 1986)]),
    ('capcom', 'Capcom', 'japanese', [('Mega Man', 1987), ('Resident Evil', 1996), ('Devil May Cry 3: Dante’s Awakening', 2005),
                                     ('Resident Evil 4', 2005), ('Dead Rising', 2006)]),
    ('nintendo-rd1', 'Nintendo R&D1 (Yoshio Sakamoto)', 'japanese', [('Super Metroid', 1994), ('WarioWare, Inc.: Mega Microgames!', 2003)]),
    ('game-freak', 'Game Freak (Satoshi Tajiri)', 'japanese', [('Pokemon Blue Version', 1996)]),
    ('team-ico', 'Fumito Ueda (Team Ico)', 'japanese', [('Ico', 2001)]),
    ('nintendo-ead', 'Nintendo EAD and EPD', 'japanese', [('Animal Crossing', 2003), ('Mario Kart 8', 2014), ('Super Mario Maker', 2015),
                                                          ('The Legend of Zelda: Breath of the Wild', 2017)]),
    ('takahashi', 'Keita Takahashi (Namco)', 'japanese', [('Katamari Damacy', 2004)]),
    ('fromsoftware', 'FromSoftware (Hidetaka Miyazaki)', 'japanese', [('Dark Souls', 2011)]),
    ('chunsoft', 'Kotaro Uchikoshi (Chunsoft)', 'japanese', [("Zero Escape: Virtue's Last Reward", 2012)]),
    ('kojima', 'Hideo Kojima', 'japanese', [('Metal Gear Solid V: The Phantom Pain', 2015)]),
    ('ryu-ga-gotoku', 'Ryu Ga Gotoku Studio', 'japanese', [('Yakuza 0', 2015)]),
    ('atlus', 'Atlus', 'japanese', [('Persona 5', 2016)]),
    # Action and feel.
    ('id-software', 'id Software', 'action', [('DOOM', 1993), ('DOOM', 2016)]),
    ('core-design', 'Core Design', 'action', [('Tomb Raider', 1996)]),
    ('valve', 'Valve', 'action', [('Half-Life', 1998), ('Portal', 2007), ('Team Fortress 2', 2007), ('Left 4 Dead', 2008), ('Half-Life: Alyx', 2020)]),
    ('neversoft', 'Neversoft', 'action', [('Tony Hawk’s Pro Skater 3', 2001)]),
    ('ubisoft-montreal', 'Ubisoft Montreal', 'action', [('Prince of Persia: The Sands of Time', 2003), ('Far Cry 2', 2008)]),
    ('infinity-ward', 'Infinity Ward', 'action', [('Call of Duty 4: Modern Warfare', 2007)]),
    ('ea-black-box', 'EA Black Box', 'action', [('Skate', 2007)]),
    ('criterion', 'Criterion Games', 'action', [('Burnout Paradise', 2008)]),
    ('rocksteady', 'Rocksteady Studios', 'action', [('Batman: Arkham Asylum', 2009)]),
    ('game-bakers', 'The Game Bakers', 'action', [('Furi', 2016)]),
    ('epic', 'Epic Games', 'action', [('Fortnite', 2017)]),
    ('monolith', 'Monolith Productions', 'action', [('Middle-Earth: Shadow of War', 2017)]),
    # Immersive sims and open worlds.
    ('looking-glass', 'Looking Glass Studios', 'immersive', [('Thief: The Dark Project', 1998)]),
    ('ion-storm', 'Ion Storm (Warren Spector)', 'immersive', [('Deus Ex', 2000)]),
    ('dma-design', 'DMA Design', 'immersive', [('Grand Theft Auto III', 2001)]),
    ('bioware', 'BioWare', 'immersive', [('Mass Effect', 2007)]),
    ('irrational', 'Irrational Games (Ken Levine)', 'immersive', [('BioShock', 2007)]),
    ('obsidian', 'Obsidian Entertainment', 'immersive', [('Fallout: New Vegas', 2010)]),
    ('bethesda', 'Bethesda Game Studios', 'immersive', [('The Elder Scrolls V: Skyrim', 2011)]),
    ('arkane', 'Arkane Studios', 'immersive', [('Dishonored', 2012)]),
    ('io-interactive', 'IO Interactive', 'immersive', [('Hitman', 2016)]),
    ('colepowered', 'ColePowered Games', 'immersive', [('Shadows of Doubt', 2023)]),
    # Horror.
    ('team-silent', 'Team Silent (Konami)', 'horror', [('Silent Hill 2', 2001)]),
    ('ea-redwood-shores', 'EA Redwood Shores', 'horror', [('Dead Space', 2008)]),
    ('frictional', 'Frictional Games', 'horror', [('Amnesia: The Dark Descent', 2010)]),
    ('creative-assembly', 'Creative Assembly', 'horror', [('Alien: Isolation', 2014)]),
    # Strategy, simulation and systems.
    ('maxis', 'Maxis (Will Wright)', 'systems', [('SimCity 2000', 1993), ('The Sims', 2000)]),
    ('ccp', 'CCP Games', 'systems', [('EVE Online', 2003)]),
    ('bay-12', 'Bay 12 Games (Tarn and Zach Adams)', 'systems', [('Dwarf Fortress', 2006)]),
    ('firaxis', 'Firaxis Games', 'systems', [('Civilization V', 2010), ('XCOM: Enemy Unknown', 2012)]),
    ('mojang', 'Mojang', 'systems', [('Minecraft', 2011)]),
    ('zachtronics', 'Zachtronics', 'systems', [('SpaceChem', 2011)]),
    ('squad', 'Squad', 'systems', [('Kerbal Space Program', 2015)]),
    ('wube', 'Wube Software', 'systems', [('Factorio', 2016)]),
    ('sylvester', 'Tynan Sylvester (Ludeon Studios)', 'systems', [('Rimworld', 2018)]),
    ('subset', 'Subset Games', 'systems', [('Into the Breach', 2018)]),
    # Roguelikes and runs.
    ('toy-wichman', 'Michael Toy & Glenn Wichman', 'roguelike', [('Rogue', 1980)]),
    ('blizzard-north', 'Blizzard North', 'roguelike', [('Diablo II', 2000)]),
    ('derek-yu', 'Derek Yu', 'roguelike', [('Spelunky', 2008)]),
    ('moppin', 'Moppin', 'roguelike', [('Downwell', 2015)]),
    ('megacrit', 'Mega Crit', 'roguelike', [('Slay the Spire', 2019)]),
    ('mullins', 'Daniel Mullins', 'roguelike', [('Inscryption', 2021)]),
    # Stories you play.
    ('frasca', 'Gonzalo Frasca', 'stories', [('September 12th', 2003)]),
    ('telltale', 'Telltale Games', 'stories', [('The Walking Dead', 2012)]),
    ('yager', 'Yager', 'stories', [('Spec Ops: The Line', 2012)]),
    ('galactic-cafe', 'Davey Wreden (Galactic Cafe)', 'stories', [('The Stanley Parable', 2013)]),
    ('fares', 'Josef Fares (Starbreeze)', 'stories', [('Brothers: A Tale of Two Sons', 2013)]),
    ('fullbright', 'The Fullbright Company', 'stories', [('Gone Home', 2013)]),
    ('lucas-pope', 'Lucas Pope', 'stories', [('Papers, Please', 2013)]),
    ('barlow', 'Sam Barlow', 'stories', [('Her Story', 2015)]),
    ('toby-fox', 'Toby Fox', 'stories', [('Undertale', 2015)]),
    ('mountains', 'Mountains (Ken Wong)', 'stories', [('Florence', 2018)]),
    ('za-um', 'ZA/UM', 'stories', [('Disco Elysium', 2019)]),
    # Indie and art games.
    ('chahi', 'Éric Chahi', 'indie', [('Another World', 1991)]),
    ('cyan', 'Cyan', 'indie', [('Myst', 1993)]),
    ('thatgamecompany', 'thatgamecompany', 'indie', [('flOw', 2006), ('Journey', 2012)]),
    ('rohrer', 'Jason Rohrer', 'indie', [('Passage', 2007)]),
    ('saltsman', 'Adam Saltsman', 'indie', [('Canabalt', 2009)]),
    ('klei', 'Klei Entertainment', 'indie', [('Mark of the Ninja', 2012)]),
    ('image-and-form', 'Image & Form', 'indie', [('SteamWorld Dig', 2013)]),
    ('foddy', 'Bennett Foddy', 'indie', [('Getting Over It, with Bennett Foddy', 2017)]),
    ('thorson-berry', 'Maddy Thorson & Noel Berry', 'indie', [('Celeste', 2018)]),
    ('mobius', 'Mobius Digital', 'indie', [('Outer Wilds', 2019)]),
    ('shouldice', 'Andrew Shouldice', 'indie', [('Tunic', 2022)]),
    # Playing together.
    ('henry-smith', 'Henry Smith (Sleeping Beast Games)', 'together', [('Spaceteam', 2012)]),
    ('ghost-town', 'Ghost Town Games', 'together', [('Overcooked!', 2016)]),
    ('innersloth', 'Innersloth', 'together', [('Among Us', 2018)]),
]

# Books the play list's makers wrote, under them.
WRITINGS = {
    'kojima': [book('creative-gene', 'The Creative Gene')],
    'sylvester': [book('designing-games', 'Designing Games')],
}
# Brown's games listed under an entry in another node: inkle's, under narrative design.
ELSEWHERE = {('80 Days', 2014)}
# Brown's spellings the list keeps, and the few it corrects.
TITLES = {'Pokemon Blue Version': 'Pokémon Blue Version', 'Rimworld': 'RimWorld'}


def play_list():
    wanted = (set(BROWN) | set(MOMA)) - ELSEWHERE
    made = [(t, y) for _, _, _, games in MAKERS for t, y in games]
    assert len(made) == len(set(made)), 'a game listed twice'
    assert set(made) == wanted, (sorted(wanted - set(made)), sorted(set(made) - wanted))
    moma = set(MOMA)
    entries = []
    for id, name, school, games in MAKERS:
        works = [work(f'{slug(t)}-{y}', f'{TITLES.get(t, t)} ({y})') for t, y in sorted(games, key=lambda g: g[1])]
        entries.append(person(id, name, school, works + WRITINGS.get(id, [])))
    return entries


PLAY_LIST = [
    single('brown-100', "Mark Brown, The 100 Games That Taught Me Game Design", 'canon', 'game'),
    single('moma-14', "MoMA's First 14 (2012)", 'canon', 'game'),
    *play_list(),
]

# Stage 2, months 4–9: one Boss Fight book a month, the game played alongside.
CLOSE_READING = [
    person('boss-fight-books', 'Boss Fight Books', 'close-reading', [
        book('bfb-spelunky', 'Spelunky (Derek Yu)', True),
        book('bfb-shadow-of-the-colossus', 'Shadow of the Colossus', True),
        book('bfb-outer-wilds', 'Outer Wilds', True),
        *[book(f'bfb-{slug(t)}', t) for t in [
            'EarthBound', 'Chrono Trigger', 'ZZT', 'Galaga', 'Jagged Alliance 2', "Baldur's Gate II",
            'Metal Gear Solid', "Majora's Mask", 'Silent Hill 2', 'Katamari Damacy', 'Day of the Tentacle',
            'Untitled Goose Game']],
    ], 'book', rule='core'),
    single('well-played', 'Well Played (ETC Press)', 'close-reading'),
    single('how-to-play-video-games', 'Payne & Huntemann (eds.), How to Play Video Games', 'close-reading'),
]

# The larger milestones of practice. The monthly stage is a habit; quarters and years are not periods.
PRACTICE = [
    *[person(f'jam-{n}', f'Game Jam, Quarter {n}', 'ship-a-stage', [
        work(f'jam-{n}-enter', 'Enter Ludum Dare or GMTK', 'artefact', True),
        work(f'jam-{n}-postmortem', 'Write the Postmortem', 'artefact', True),
    ], 'artefact', kind='ship') for n in range(1, 5)],
    single('one-small-finished-game', 'One Small Finished Game', 'finished-game', 'artefact', 'ship'),
]


def node(id, name, icon, after=None, count=None, kind=None, extra=None):
    requires = []
    if after:
        requires.append({'node': after})
    if count:
        requires.append({'count': {'min': count, **(extra or {})}})
    return {'id': id, 'name': name, 'icon': icon, 'kind': kind, 'requires': requires}


TREE = {
    'id': 'games',
    'name': 'Games',
    'mount': 'mastery/practical',
    'nodes': [
        node('root', 'Games', 'device-gamepad-2', kind='root'),
        # Design.
        node('foundations', 'Game Design Foundations', 'school', ['root'], 3),
        node('design-craft', 'Design Craft', 'tools', ['foundations'], 2),
        node('narrative', 'Narrative Design', 'writing', ['foundations'], 2),
        # The play list, by school.
        node('canon', 'The Play List', 'trophy', ['root'], 1),
        node('arcade', 'Arcade and Score', 'joystick', ['canon'], 3),
        node('japanese', 'Japanese Masters', 'sun', ['canon'], 3),
        node('action', 'Action and Feel', 'bolt', ['canon'], 3),
        node('immersive', 'Immersive Sims and Open Worlds', 'map-2', ['canon'], 3),
        node('horror', 'Horror', 'ghost', ['canon'], 2),
        node('systems', 'Strategy, Simulation and Systems', 'chess', ['canon'], 3),
        node('roguelike', 'Roguelikes and Runs', 'dice-5', ['canon'], 2),
        node('stories', 'Stories You Play', 'book', ['canon'], 3),
        node('indie', 'Indie and Art Games', 'palette', ['canon'], 3),
        node('together', 'Playing Together', 'users', ['canon'], 2),
        node('close-reading', 'Close Reading', 'eye', ['canon'], 2),
        # What all of it is for.
        node('ship-a-stage', 'Ship a Stage', 'flag', ['design-craft'], 1, 'keystone', {'kind': 'ship'}),
        node('finished-game', 'A Small Finished Game', 'rocket', ['ship-a-stage'], 1, 'keystone', {'kind': 'ship'}),
    ],
}

# The practice rhythm, counted from what you write up: a week's game, the week's build, the month's stage.
HABITS = [
    {'id': 'play-as-a-director', 'name': 'Play a Game as a Director', 'period': 'week', 'target': 1, 'counts': {'method': 'five-passes'}},
    {'id': 'weekly-build', 'name': 'Build One Exercise', 'period': 'week', 'target': 1, 'counts': {'kind': 'Practice'}},
    {'id': 'monthly-stage', 'name': 'Finish One Playable Stage', 'period': 'month', 'target': 1, 'counts': {'kind': 'Ship'}},
]

TRACKS = [
    ('design', 'Game Design', FOUNDATIONS + DESIGN_CRAFT + NARRATIVE),
    ('play-list', 'The Play List', PLAY_LIST),
    ('close-reading', 'Close Reading', CLOSE_READING),
    ('practice', 'Practice', PRACTICE),
]


def write():
    ids = set()
    lines = [
        '# Games, one of the three trees of the game director\'s self-education (film and theatre beside it).',
        '# Generated by gen_games.py; edit the lists there and run it again.',
        'goal: games',
        'name: Games',
        '',
        'tracks:',
    ]
    entries = 0
    for track_id, name, items in TRACKS:
        lines += [f'  - id: {track_id}', f'    name: {q(name)}', '    state: active', '    items:']
        for it in items:
            assert it['id'] not in ids, it['id']
            ids.add(it['id'])
            entries += 1
            lines += [
                f'      - id: {it["id"]}',
                f'        title: {q(it["title"])}',
                f'        kind: {it["kind"]}',
                f'        medium: {it["medium"]}',
                f'        tags: [{", ".join(it["tags"])}]',
            ]
            if it['rule'] and it['children']:
                lines.append(f'        childRule: {q(it["rule"]) if ":" in it["rule"] else it["rule"]}')
            if it['children']:
                seen = set()
                lines.append('        children:')
                for c in it['children']:
                    assert c['id'] not in seen, (it['id'], c['id'])
                    seen.add(c['id'])
                    core = ', core: true' if c['core'] else ''
                    lines.append(f'          - {{ id: {c["id"]}, title: {q(c["title"])}, medium: {c["medium"]}{core} }}')
    flow = lambda v: json.dumps(v, ensure_ascii=False).replace('"', '') if isinstance(v, (dict, list)) else q(v)
    lines += ['', 'trees:', f'  - id: {TREE["id"]}', f'    name: {q(TREE["name"])}', f'    mount: {TREE["mount"]}', '    nodes:']
    for n in TREE['nodes']:
        kind = f', kind: {n["kind"]}' if n['kind'] else ''
        req = f', requires: {flow(n["requires"])}' if n['requires'] else ''
        lines.append(f'      - {{ id: {n["id"]}, name: {q(n["name"])}{kind}, icon: {n["icon"]}{req} }}')
    lines += ['', 'habits:']
    for h in HABITS:
        lines.append(f'  - {{ id: {h["id"]}, name: {q(h["name"])}, period: {h["period"]}, target: {h["target"]}, counts: {flow(h["counts"])} }}')
    open(OUT, 'w').write('\n'.join(lines) + '\n')
    print(f'{OUT}: {entries} entries')


if __name__ == '__main__':
    write()
