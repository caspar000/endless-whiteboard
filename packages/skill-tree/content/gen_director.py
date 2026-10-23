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

# Scorsese's 39, in the order of his note to Colin Levy, as (title, director).
SCORSESE = [
    ('Metropolis', 'Fritz Lang'), ('Nosferatu', 'F.W. Murnau'), ('Dr. Mabuse, the Gambler', 'Fritz Lang'),
    ('Napoleon', 'Abel Gance'), ('Grand Illusion', 'Jean Renoir'), ('The Rules of the Game', 'Jean Renoir'),
    ('Children of Paradise', 'Marcel Carné'), ('Rome, Open City', 'Roberto Rossellini'), ('Paisan', 'Roberto Rossellini'),
    ('La Terra Trema', 'Luchino Visconti'), ('The Bicycle Thief', 'Vittorio De Sica'), ('Umberto D', 'Vittorio De Sica'),
    ('Beauty and the Beast', 'Jean Cocteau'), ('Tokyo Story', 'Yasujirō Ozu'), ('Ikiru', 'Akira Kurosawa'),
    ('Seven Samurai', 'Akira Kurosawa'), ('Ugetsu', 'Kenji Mizoguchi'), ('Sansho the Bailiff', 'Kenji Mizoguchi'),
    ('High and Low', 'Akira Kurosawa'), ('Big Deal on Madonna Street', 'Mario Monicelli'),
    ('Rocco and His Brothers', 'Luchino Visconti'), ('The 400 Blows', 'François Truffaut'),
    ('Shoot the Piano Player', 'François Truffaut'), ('Breathless', 'Jean-Luc Godard'),
    ('Band of Outsiders', 'Jean-Luc Godard'), ('Il Sorpasso', 'Dino Risi'), ('L’avventura', 'Michelangelo Antonioni'),
    ('Blow-Up', 'Michelangelo Antonioni'), ('Before the Revolution', 'Bernardo Bertolucci'),
    ('Le Boucher', 'Claude Chabrol'), ('Weekend', 'Jean-Luc Godard'), ('Death by Hanging', 'Nagisa Ōshima'),
    ('The Merchant of Four Seasons', 'Rainer Werner Fassbinder'), ('Ali: Fear Eats the Soul', 'Rainer Werner Fassbinder'),
    ('The Marriage of Maria Braun', 'Rainer Werner Fassbinder'), ('Kings of the Road', 'Wim Wenders'),
    ('The American Friend', 'Wim Wenders'), ('The Mystery of Kaspar Hauser', 'Werner Herzog'),
    ('Aguirre, the Wrath of God', 'Werner Herzog'),
]
assert len(SCORSESE) == 39

# Sight & Sound 2022, the directors' poll (bfi.org.uk), as (rank, title, year, director). Twelve
# films tie at 93, so it holds 104.
SIGHT_AND_SOUND = [
    (1, '2001: A Space Odyssey', 1968, 'Stanley Kubrick'),
    (2, 'Citizen Kane', 1941, 'Orson Welles'),
    (3, 'The Godfather', 1972, 'Francis Ford Coppola'),
    (4, 'Jeanne Dielman, 23 Quai du Commerce, 1080 Bruxelles', 1975, 'Chantal Akerman'),
    (4, 'Tokyo Story', 1953, 'Yasujirō Ozu'),
    (6, 'Vertigo', 1958, 'Alfred Hitchcock'),
    (6, '8½', 1963, 'Federico Fellini'),
    (8, 'Mirror', 1975, 'Andrei Tarkovsky'),
    (9, 'In the Mood for Love', 2000, 'Wong Kar Wai'),
    (9, 'Close-up', 1989, 'Abbas Kiarostami'),
    (9, 'Persona', 1966, 'Ingmar Bergman'),
    (12, 'Taxi Driver', 1976, 'Martin Scorsese'),
    (12, 'Barry Lyndon', 1975, 'Stanley Kubrick'),
    (14, 'Beau travail', 1998, 'Claire Denis'),
    (14, 'Seven Samurai', 1954, 'Akira Kurosawa'),
    (14, 'À bout de souffle', 1960, 'Jean-Luc Godard'),
    (14, 'Stalker', 1979, 'Andrei Tarkovsky'),
    (18, 'Apocalypse Now', 1979, 'Francis Ford Coppola'),
    (18, 'A Woman under the Influence', 1974, 'John Cassavetes'),
    (20, 'Bicycle Thieves', 1948, 'Vittorio De Sica'),
    (20, 'Rashomon', 1950, 'Akira Kurosawa'),
    (22, 'Mulholland Dr.', 2001, 'David Lynch'),
    (22, 'Pather Panchali', 1955, 'Satyajit Ray'),
    (22, 'The Battle of Algiers', 1966, 'Gillo Pontecorvo'),
    (22, 'Raging Bull', 1980, 'Martin Scorsese'),
    (26, 'Andrei Rublev', 1966, 'Andrei Tarkovsky'),
    (26, 'The Godfather Part II', 1974, 'Francis Ford Coppola'),
    (28, 'GoodFellas', 1990, 'Martin Scorsese'),
    (29, 'Do the Right Thing', 1989, 'Spike Lee'),
    (30, 'Man with a Movie Camera', 1929, 'Dziga Vertov'),
    (30, 'The Passion of Joan of Arc', 1927, 'Carl Th. Dreyer'),
    (30, 'Ordet', 1955, 'Carl Th. Dreyer'),
    (33, 'Sunrise: A Song of Two Humans', 1927, 'F.W. Murnau'),
    (33, 'The 400 Blows', 1959, 'François Truffaut'),
    (35, 'La dolce vita', 1960, 'Federico Fellini'),
    (35, 'La Jetée', 1962, 'Chris Marker'),
    (37, 'Au hasard Balthazar', 1966, 'Robert Bresson'),
    (38, 'La Règle du jeu', 1939, 'Jean Renoir'),
    (38, "L'avventura", 1960, 'Michelangelo Antonioni'),
    (38, 'La strada', 1954, 'Federico Fellini'),
    (41, 'Playtime', 1967, 'Jacques Tati'),
    (41, 'The Night of the Hunter', 1955, 'Charles Laughton'),
    (41, 'A Man Escaped', 1956, 'Robert Bresson'),
    (41, 'Vagabond', 1985, 'Agnès Varda'),
    (41, 'Come and See', 1985, 'Elem Klimov'),
    (46, 'Psycho', 1960, 'Alfred Hitchcock'),
    (46, "L'Atalante", 1934, 'Jean Vigo'),
    (46, 'Le Mépris', 1963, 'Jean-Luc Godard'),
    (46, 'Once upon a Time in the West', 1968, 'Sergio Leone'),
    (46, "Don't Look Now", 1973, 'Nicolas Roeg'),
    (46, 'Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb', 1963, 'Stanley Kubrick'),
    (52, "Singin' in the Rain", 1951, 'Gene Kelly, Stanley Donen'),
    (52, 'Cléo from 5 to 7', 1962, 'Agnès Varda'),
    (52, 'City Lights', 1931, 'Charles Chaplin'),
    (52, 'The Piano', 1992, 'Jane Campion'),
    (52, 'Fear Eats the Soul', 1974, 'Rainer Werner Fassbinder'),
    (52, 'La Maman et la Putain', 1973, 'Jean Eustache'),
    (52, 'Fanny and Alexander', 1982, 'Ingmar Bergman'),
    (52, 'La notte', 1961, 'Michelangelo Antonioni'),
    (52, 'Eraserhead', 1976, 'David Lynch'),
    (52, 'Viridiana', 1961, 'Luis Buñuel'),
    (62, 'Meshes of the Afternoon', 1943, 'Maya Deren, Alexander Hackenschmied'),
    (62, 'Late Spring', 1949, 'Yasujirō Ozu'),
    (62, 'Some Like It Hot', 1959, 'Billy Wilder'),
    (62, 'Blade Runner', 1982, 'Ridley Scott'),
    (62, 'Sunset Blvd.', 1950, 'Billy Wilder'),
    (62, 'Sátántangó', 1994, 'Béla Tarr'),
    (62, 'Tropical Malady', 2004, 'Apichatpong Weerasethakul'),
    (62, 'Jaws', 1975, 'Steven Spielberg'),
    (62, 'Lawrence of Arabia', 1962, 'David Lean'),
    (62, 'La ciénaga', 2001, 'Lucrecia Martel'),
    (72, 'The Searchers', 1956, 'John Ford'),
    (72, 'Shoah', 1985, 'Claude Lanzmann'),
    (72, 'News from Home', 1976, 'Chantal Akerman'),
    (72, 'Sans soleil', 1982, 'Chris Marker'),
    (72, 'Touki Bouki', 1973, 'Djibril Diop Mambéty'),
    (72, 'The Red Shoes', 1948, 'Michael Powell, Emeric Pressburger'),
    (72, 'Modern Times', 1936, 'Charles Chaplin'),
    (72, 'A Brighter Summer Day', 1991, 'Edward Yang'),
    (72, 'The Spirit of the Beehive', 1973, 'Víctor Erice'),
    (72, 'Blue Velvet', 1986, 'David Lynch'),
    (72, 'Wild Strawberries', 1957, 'Ingmar Bergman'),
    (72, 'The Ascent', 1976, 'Larissa Shepitko'),
    (72, 'The Seventh Seal', 1957, 'Ingmar Bergman'),
    (72, 'Chinatown', 1974, 'Roman Polanski'),
    (72, 'Ikiru', 1952, 'Akira Kurosawa'),
    (72, "Where Is the Friend's House?", 1987, 'Abbas Kiarostami'),
    (72, "L'Argent", 1983, 'Robert Bresson'),
    (72, 'The Conversation', 1974, 'Francis Ford Coppola'),
    (72, 'Salò, or the 120 Days of Sodom', 1975, 'Pier Paolo Pasolini'),
    (72, 'A Separation', 2011, 'Asghar Farhadi'),
    (72, 'Kes', 1969, 'Ken Loach'),
    (93, 'Wanda', 1970, 'Barbara Loden'),
    (93, 'Battleship Potemkin', 1925, 'Sergei M. Eisenstein'),
    (93, 'Moonlight', 2016, 'Barry Jenkins'),
    (93, 'Yi Yi', 1999, 'Edward Yang'),
    (93, 'Parasite', 2019, 'Bong Joon-ho'),
    (93, 'The Conformist', 1970, 'Bernardo Bertolucci'),
    (93, 'The Colour of Pomegranates', 1968, 'Sergei Paradjanov'),
    (93, 'Pickpocket', 1959, 'Robert Bresson'),
    (93, 'Taste of Cherry', 1997, 'Abbas Kiarostami'),
    (93, 'Hidden', 2004, 'Michael Haneke'),
    (93, 'Eternal Sunshine of the Spotless Mind', 2004, 'Michel Gondry'),
    (93, 'Throne of Blood', 1957, 'Akira Kurosawa'),
]
assert len(SIGHT_AND_SOUND) == 104

# The directors' poll in four bands of rank, so a band is a few months' viewing.
SS_BANDS = [(1, 21), (22, 41), (46, 62), (72, 93)]


def sight_and_sound():
    out = []
    for first, last in SS_BANDS:
        films = [f for f in SIGHT_AND_SOUND if first <= f[0] <= last]
        out.append(item(
            f'sight-and-sound-{first}-{last}', f"Sight & Sound Directors' Poll: {first}–{last}", 'film', ['film-canon'],
            children=[child(f'{t} ({y})', 'film', id=f'ss-{slug(t)}-{y}') for _, t, y, _ in films], rule='all',
        ))
    assert sum(len(b['children']) for b in out) == 104
    return out


WESTERN_FILM = [
    # The spine: one chapter a month, with its "Where to Go from Here" viewings.
    item('bordwell-thompson-film-art', 'Bordwell & Thompson, Film Art: An Introduction', 'book', ['film-craft']),
    # Stage 1: Lumet, and one Scorsese film a week.
    item('lumet-making-movies', 'Lumet, Making Movies', 'book', ['film-craft']),
    item('scorsese-39', "Scorsese's 39 Foreign Films", 'film', ['film-canon'],
         children=[child(t, 'film', id=f'scorsese-{slug(t)}') for t, _ in SCORSESE], rule='all'),
    # Stage 2, and the rest of the craft shelf in the page's order.
    item('mackendrick-on-film-making', 'Mackendrick, On Film-making', 'book', ['film-craft']),
    item('mamet-on-directing-film', 'Mamet, On Directing Film', 'book', ['film-craft']),
    item('murch-in-the-blink-of-an-eye', 'Murch, In the Blink of an Eye', 'book', ['film-craft']),
    item('weston-directing-actors', 'Weston, Directing Actors', 'book', ['film-craft']),
    item('brook-empty-space', 'Brook, The Empty Space', 'book', ['film-craft']),
    item('mitchell-directors-craft', "Mitchell, The Director's Craft", 'book', ['film-craft']),
    # How to read a scene: the sheet's sources, the method books and the free talks.
    item('corrigan-writing-about-film', 'Corrigan, A Short Guide to Writing About Film', 'book', ['film-craft']),
    item('film-method-books', 'Method Books', 'book', ['film-craft'], children=[
        child('Van Sijll, Cinematic Storytelling', 'work', id='van-sijll-cinematic-storytelling'),
        child('Rabiger, Directing', 'work', id='rabiger-directing'),
        child('Block, The Visual Story', 'work', id='block-visual-story'),
        child('Katz, Shot by Shot', 'work', id='katz-shot-by-shot'),
        child('Nitsche, Video Game Spaces', 'work', id='nitsche-video-game-spaces'),
    ]),
    item('film-to-level-talks', 'Film to Level: Talks', 'talk', ['film-craft'], children=[
        child('Bellard, "Environment Design as Spatial Cinematography" (GDC 2019)', 'talk', core=True, id='bellard-spatial-cinematography'),
        child('Hill, "Interactive Pacing"', 'talk', id='hill-interactive-pacing'),
    ]),
    item('every-frame-a-painting', 'Every Frame a Painting', 'talk', ['film-craft'], children=[
        child('Memories of Murder: Ensemble Staging', 'talk', id='efap-memories-of-murder'),
        child('Akira Kurosawa: Composing Movement', 'talk', id='efap-kurosawa-composing-movement'),
        child('How Does an Editor Think and Feel?', 'talk', id='efap-editor-think-and-feel'),
    ], rule='all'),
    # Stage 3: the canon.
    *sight_and_sound(),
    item('1001-movies', '1001 Movies You Must See Before You Die', 'book', ['film-canon']),
]


def film(title, tags, id=None):
    return item(id or slug(title), title, 'film', tags)


SOVIET_FILM = [
    # The shortest route through all three schools, then the rest of Tier 1.
    film('Battleship Potemkin (Eisenstein, 1925)', ['soviet-film', 'montage'], 'battleship-potemkin'),
    film('Stalker (Tarkovsky, 1979)', ['soviet-film', 'long-take'], 'stalker'),
    item('strugatsky-roadside-picnic', 'Strugatsky, Roadside Picnic (Bormashenko)', 'book', ['soviet-film', 'long-take']),
    item('ivan-the-terrible', 'Ivan the Terrible (Eisenstein, 1944–58)', 'film', ['soviet-film', 'tableau'], children=[
        child('Ivan the Terrible, Part I', 'film', core=True, id='ivan-the-terrible-part-1'),
        child('Ivan the Terrible, Part II', 'film', core=True, id='ivan-the-terrible-part-2'),
    ], rule='all'),
    film('Andrei Rublev (Tarkovsky, 1966)', ['soviet-film', 'long-take'], 'andrei-rublev'),
    film('The Cranes Are Flying (Kalatozov, 1957)', ['soviet-film', 'long-take'], 'the-cranes-are-flying'),
    film('Come and See (Klimov, 1985)', ['soviet-film'], 'come-and-see'),
    film('Man with a Movie Camera (Vertov, 1929)', ['soviet-film', 'montage'], 'man-with-a-movie-camera'),
    film('I Am Cuba (Kalatozov)', ['soviet-film', 'long-take'], 'i-am-cuba'),
    film('Russian Ark (Sokurov)', ['soviet-film', 'long-take'], 'russian-ark'),
    film('Mirror (Tarkovsky, 1975)', ['soviet-film', 'long-take'], 'mirror'),
    film('Solaris (Tarkovsky)', ['soviet-film', 'long-take'], 'solaris'),
    film('Kin-dza-dza!', ['soviet-film'], 'kin-dza-dza'),
    film('The Ascent (Shepitko, 1976)', ['soviet-film'], 'the-ascent'),
    film("Aleksei German's Late Trilogy", ['soviet-film'], 'aleksei-german-late-trilogy'),
    # Tier 2.
    item('eisenstein-montage-films', "Eisenstein's Montage Films", 'film', ['soviet-film', 'montage'], children=[
        child('Strike', 'film', id='strike'),
        child('October', 'film', id='october'),
        child('Alexander Nevsky', 'film', id='alexander-nevsky'),
    ], rule='all'),
    film("Pudovkin's Films", ['soviet-film', 'montage'], 'pudovkin-films'),
    film('By the Law (Kuleshov)', ['soviet-film'], 'by-the-law'),
    film('Earth (Dovzhenko)', ['soviet-film'], 'earth'),
    film("Muratova's Films", ['soviet-film'], 'muratova-films'),
    # Tier 3.
    film("Gaidai's Comedies", ['soviet-film'], 'gaidai-comedies'),
    film("Ptushko's Fantasies", ['soviet-film'], 'ptushko-fantasies'),
    film("Norstein's Animation", ['soviet-film'], 'norstein-animation'),
    # The theory shelf.
    item('tarkovsky-sculpting-in-time', 'Tarkovsky, Sculpting in Time', 'book', ['soviet-film', 'long-take']),
    item('eisenstein-film-form', 'Eisenstein, Film Form and The Film Sense', 'book', ['soviet-film', 'montage']),
    item('eisenstein-selected-works', 'Eisenstein, Selected Works 1–4 (ed. Taylor)', 'book', ['soviet-film', 'montage']),
    item('pudovkin-film-technique', 'Pudovkin, Film Technique and Film Acting', 'book', ['soviet-film', 'montage']),
    item('vertov-kino-eye', 'Vertov, Kino-Eye', 'book', ['soviet-film', 'montage']),
    item('kuleshov-on-film', 'Kuleshov on Film', 'book', ['soviet-film', 'montage']),
    item('kozintsev-hamlet-lear', 'Kozintsev on Hamlet and Lear', 'book', ['soviet-film']),
    item('bordwell-cinema-of-eisenstein', 'Bordwell, The Cinema of Eisenstein', 'book', ['soviet-film', 'tableau']),
    item('bird-tarkovsky', 'Bird, Andrei Tarkovsky: Elements of Cinema', 'book', ['soviet-film', 'long-take']),
    item('beumers-history-of-russian-cinema', 'Beumers, A History of Russian Cinema', 'book', ['soviet-film']),
]

GEORGIAN_FILM = [
    # Classics and the new wave, in the page's order.
    film('Repentance (Abuladze, 1984)', ['georgian-film', 'one-rule'], 'repentance'),
    film('The Color of Pomegranates (Parajanov, 1969)', ['georgian-film', 'tableau'], 'the-color-of-pomegranates'),
    film('Pirosmani (G. Shengelaia, 1969)', ['georgian-film', 'tableau'], 'pirosmani'),
    film('Blue Mountains (E. Shengelaia, 1983)', ['georgian-film', 'one-rule'], 'blue-mountains'),
    film('My Grandmother (Mikaberidze, 1929)', ['georgian-film', 'one-rule'], 'my-grandmother'),
    item('iosseliani-georgian-features', "Iosseliani's Three Georgian Features", 'film', ['georgian-film', 'one-rule'], children=[
        child('Falling Leaves', 'film', core=True, id='falling-leaves'),
        child('Singing Blackbird', 'film', core=True, id='singing-blackbird'),
        child('Pastorale', 'film', core=True, id='pastorale'),
    ], rule='all'),
    film('What Do We See When We Look at the Sky? (Koberidze, 2021)', ['georgian-film', 'one-rule'], 'what-do-we-see'),
    film('Beginning (Kulumbegashvili, 2020)', ['georgian-film', 'long-take'], 'beginning'),
    # The rest of Tier 1A.
    film('The Plea', ['georgian-film', 'one-rule'], 'the-plea'),
    film('The Wishing Tree', ['georgian-film'], 'the-wishing-tree'),
    film("Kobakhidze's Dialogue-Free Shorts", ['georgian-film', 'one-rule'], 'kobakhidze-shorts'),
    # Tier 1B: after 1991, films already built as stages.
    film('My Happy Family', ['georgian-film'], 'my-happy-family'),
    film('In Bloom', ['georgian-film'], 'in-bloom'),
    film('April (Kulumbegashvili, 2024)', ['georgian-film'], 'april-2024'),
    film('Corn Island', ['georgian-film'], 'corn-island'),
    film('Holy Electricity', ['georgian-film'], 'holy-electricity'),
    # More one-rule films.
    film('April (Iosseliani, 1962)', ['georgian-film', 'one-rule'], 'april-1962'),
    film('19th Century Georgian Chronicle', ['georgian-film', 'one-rule'], '19th-century-georgian-chronicle'),
    film('Our Courtyard', ['georgian-film', 'one-rule'], 'our-courtyard'),
    film("Don't Grieve!", ['georgian-film', 'one-rule'], 'dont-grieve'),
    film('Mimino', ['georgian-film', 'one-rule'], 'mimino'),
    # Tier 2.
    item('parajanov-late-films', "Parajanov's Late Films", 'film', ['georgian-film', 'tableau'], children=[
        child('The Legend of Suram Fortress', 'film', core=True, id='suram-fortress'),
        child('Ashik Kerib', 'film', id='ashik-kerib'),
        child('Arabesques on the Pirosmani Theme', 'film', id='arabesques-on-pirosmani'),
    ]),
    *[film(t, ['georgian-film'], slug(t)) for t in [
        'Salt for Svanetia', 'Eliso', 'The Eccentrics', 'Great Green Valley', 'Tangerines', '13 Tzameti',
        'Dry Leaf', 'City of the Sun', 'And Then We Danced']],
    # Reading: no English history exists, so these are the pieces there are.
    item('georgian-film-reading', 'Reading on Georgian Film', 'book', ['georgian-film'], children=[
        child('Discovering Georgian Cinema (BAMPFA/MoMA, 2014)', 'work', core=True, id='discovering-georgian-cinema'),
        child('Adrian Martin on Parajanov', 'work', id='adrian-martin-parajanov'),
        child('KinoKultura Special Issue 12', 'work', id='kinokultura-12'),
        child('Nino Dzandzava in Apparatus', 'work', id='dzandzava-apparatus'),
        child('Steffen, The Cinema of Sergei Parajanov', 'work', id='steffen-parajanov'),
        child('Family Affairs (Arsenal Berlin)', 'work', id='family-affairs-arsenal'),
        child('Radvanyi & Amiredzibi, Le Cinéma géorgien (French)', 'work', id='le-cinema-georgien'),
    ]),
]

# Film weeks as units: the month's school, two films a month, the rotation run twice. The paired
# game is named only where the page names one.
FILM_WEEKS = [
    ('montage', 'Battleship Potemkin', 'a game whose cuts and level transitions you want to study'),
    ('montage', 'Strike', None),
    ('tableau', 'The Color of Pomegranates', 'Pathologic 2'),
    ('tableau', 'The Legend of Suram Fortress', None),
    ('long-take', 'Stalker', 'S.T.A.L.K.E.R.: Shadow of Chernobyl'),
    ('long-take', 'Mirror', None),
    ('one-rule', 'Blue Mountains', 'Papers, Please'),
    ('one-rule', 'Falling Leaves', None),
    ('montage', 'October', 'a game whose cuts and level transitions you want to study'),
    ('montage', 'Alexander Nevsky', None),
    ('tableau', 'Pirosmani', None),
    ('tableau', 'Ivan the Terrible', 'Pathologic 2'),
    ('long-take', 'Beginning', None),
    ('long-take', 'Russian Ark', None),
    ('one-rule', 'April (1962)', None),
    ('one-rule', 'A Kobakhidze Short', None),
]


def film_weeks():
    out = []
    for school, title, game in FILM_WEEKS:
        w = f'week-{slug(title)}'
        out.append(item(w, f'Film Week: {title}', 'film', [school], children=[
            child(f'Watch {title} Once, With No Notes', 'film', core=True, id=f'{w}-watch'),
            child('Rewatch and Log One Scene (Sheet 1–3)', 'exercise', core=True, id=f'{w}-log'),
            child("Fill In the School's Panel and Where to Look (Sheet 4–5)", 'exercise', core=True, id=f'{w}-analyse'),
            child(f'Play {game}' if game else 'Play the Paired Game', 'game', core=True, id=f'{w}-game'),
            child('Build the Scene From Its Beat Sheet (Sheet 6)', 'exercise', core=True, id=f'{w}-build'),
            child('Playtest With Two People', 'exercise', core=True, id=f'{w}-playtest'),
            child('Write the Verdict (Sheet 7)', 'exercise', core=True, id=f'{w}-verdict'),
        ], kind='practice', rule='all'))
    return out


def books(id, title, tags, works, rule=None, medium='book'):
    """An entry whose works are listed as (title, core) pairs, ids from their titles."""
    return item(id, title, medium, tags, children=[child(t, 'work' if medium == 'book' else medium, core=c, id=f'{id}-{slug(t)}') for t, c in works], rule=rule)


# A play the curriculum names, by its id: listed again in another track, not copied.
def ref(id):
    return {'ref': f'director/{id}'}


WESTERN_THEATRE = [
    # Method and list.
    item('ball-backwards-and-forwards', 'Ball, Backwards & Forwards', 'book', ['western-theatre', 'scene-dramaturgy']),
    item('billington-101-greatest-plays', 'Billington, The 101 Greatest Plays', 'book', ['western-theatre']),
    item('norton-anthology-of-drama', 'The Norton Anthology of Drama (Shorter, 3rd ed.)', 'book', ['western-theatre']),
    item('nt2000', "The National Theatre's NT2000 List", 'book', ['western-theatre']),
    # Read first: plays that show their own rules.
    books('plays-that-show-their-rules', 'Plays That Show Their Own Rules', ['western-theatre'], [
        ('Six Characters in Search of an Author', True), ('Rosencrantz and Guildenstern Are Dead', True),
        ('Noises Off', True), ('Waiting for Godot', True), ('Woyzeck', True), ('An Inspector Calls', False)],
        medium='play'),
    # The first 25: plays on at least two of Billington, Norton and NT2000.
    books('first-25-plays', 'The First 25 Plays', ['western-theatre'], [(t, False) for t in [
        'Oedipus the King', 'Hamlet', 'Twelfth Night', 'Macbeth', 'Tartuffe', "A Doll's House",
        'The Importance of Being Earnest', 'The Cherry Orchard', 'Machinal', 'Juno and the Paycock', 'The Front Page',
        'Pygmalion', "Long Day's Journey into Night", 'A Streetcar Named Desire', 'Death of a Salesman or The Crucible',
        'Waiting for Godot', 'A Raisin in the Sun', 'The Homecoming or The Caretaker', 'Top Girls', 'Men Should Weep',
        'The Deep Blue Sea', 'Racing Demon', "Serjeant Musgrave's Dance", 'Fences', 'Angels in America',
        "Death and the King's Horseman"]], rule='all', medium='play'),
    # Directing textbooks.
    item('hodge-mclain-play-directing', 'Hodge & McLain, Play Directing', 'book', ['western-theatre', 'staging']),
    item('thomas-script-analysis', 'Thomas, Script Analysis', 'book', ['western-theatre', 'scene-dramaturgy']),
    item('clurman-on-directing', 'Clurman, On Directing', 'book', ['western-theatre']),
    item('william-ball-sense-of-direction', 'William Ball, A Sense of Direction', 'book', ['western-theatre']),
    # Theory that transfers, in the page's order.
    ref('aristotle-poetics'),
    item('laurel-computers-as-theatre', 'Laurel, Computers as Theatre', 'book', ['theatre-theory']),
    item('boal-games-for-actors', 'Boal, Games for Actors and Non-Actors', 'book', ['theatre-theory']),
    books('johnstone-spolin', 'Johnstone and Spolin', ['theatre-theory'], [
        ('Johnstone, Impro: Status and Narrative Skills', True), ('Spolin, Improvisation for the Theater', True)], rule='all'),
    item('brecht-short-description', 'Brecht, "Short Description of a New Technique of Acting"', 'book', ['theatre-theory']),
    books('appia-craig-jones-wilson', 'Appia, Craig, R. E. Jones, Wilson', ['theatre-theory', 'sets'], [
        ('Appia', False), ('Craig', False), ('R. E. Jones', False), ('Wilson', False)]),
    books('artaud-grotowski', 'Artaud and Grotowski', ['theatre-theory'], [
        ('Artaud', False), ('Grotowski, Towards a Poor Theatre', True)]),
    item('schechner-performance-theory', 'Schechner, Performance Theory', 'book', ['theatre-theory']),
    # Immersive theatre and games.
    books('immersive-theatre', 'Immersive Theatre and Games', ['theatre-theory'], [
        ("Emily Short's Notes From a Punchdrunk Masterclass", True), ('White, Audience Participation in Theatre', False),
        ('Faith (2020) on Immersive Theatre', False), ('Charitos & Timplalexi (2023), "Theatre Gamification"', False)]),
    books('theatre-gdc-talks', 'Theatre at GDC', ['theatre-theory'], [
        ('Horn, "Lessons From Theatre That Can Transform XR Experiences" (2021)', False),
        ('Tender Claws and Piehole on Live Actors in VR (2019)', False), ('To Be With Hamlet (2017)', False)], medium='talk'),
    books('play-as-performance', 'Play as Performance', ['theatre-theory'], [
        ('Fernández-Vara, Introduction to Game Analysis', False), ('Calleja, In-Game', False)]),
    books('theatre-footnotes', 'Footnotes: Adler, Meisner, Kantor', ['theatre-theory', 'acting'], [
        ('Stella Adler', False), ('Meisner', False), ('Kantor, A Journey Through Other Spaces', False)]),
]

RUSSIAN_THEATRE = [
    item('skinner-russian-theatre-in-practice', 'Skinner (ed.), Russian Theatre in Practice', 'book', ['russian-theatre']),
    # Stanislavski, in the order that keeps his vocabulary straight.
    item('carnicke-stanislavsky-in-focus', 'Carnicke, Stanislavsky in Focus', 'book', ['russian-theatre', 'acting']),
    item('stanislavski-an-actors-work', "Stanislavski, An Actor's Work (Benedetti)", 'book', ['russian-theatre', 'acting']),
    item('merlin-stanislavsky-toolkit', 'Merlin, The Complete Stanislavsky Toolkit', 'book', ['russian-theatre', 'acting']),
    books('michael-chekhov-to-the-actor', 'Michael Chekhov, To the Actor', ['russian-theatre', 'atmosphere'], [
        ('Chapter 4: Atmosphere', True), ('Chapter 5: The Psychological Gesture', True)], rule='all'),
    item('efros-joy-of-rehearsal', 'Efros, The Joy of Rehearsal', 'book', ['russian-theatre', 'scene-dramaturgy']),
    item('pitches-meyerhold-on-theatre', 'Meyerhold on Theatre (Pitches)', 'book', ['russian-theatre', 'sets']),
    item('bowlt-russian-avant-garde-theatre', 'Bowlt, Russian Avant-Garde Theatre', 'book', ['russian-theatre', 'sets']),
    # Plays, ranked by how well they transfer.
    books('russian-plays', 'Russian Plays', ['russian-theatre'], [(t, c) for t, c in [
        ('Chekhov, The Cherry Orchard', True), ('Chekhov, Three Sisters', True), ('Gogol, The Government Inspector', True),
        ('Erdman, The Suicide', False), ('Bulgakov, Flight', False), ('Schwartz, The Dragon', False),
        ('Pushkin, Boris Godunov', False), ('Gorky, The Lower Depths', False)]], medium='play'),
    item('kulyabin-three-sisters', "Kulyabin's Three Sisters (Stage Russia, Kanopy)", 'play', ['russian-theatre']),
    # Music and theory.
    item('maes-history-of-russian-music', 'Maes, A History of Russian Music', 'book', ['russian-theatre', 'sound']),
    item('rimsky-korsakov-orchestration', 'Rimsky-Korsakov, Principles of Orchestration', 'book', ['russian-theatre', 'sound']),
    books('russian-listening', 'Listening: Mussorgsky and Prokofiev', ['russian-theatre', 'sound'], [
        ('Mussorgsky, Pictures at an Exhibition', True), ('Prokofiev, Peter and the Wolf', True)], rule='all', medium='album'),
    books('russian-theory', 'Shklovsky, Propp, Bakhtin', ['russian-theatre', 'theatre-theory'], [
        ('Shklovsky on Ostranenie', True), ("Propp's 31 Functions", True), ("Bakhtin's Chronotope and Carnival", True)], rule='all'),
    item('pathologic-2', 'Pathologic 2 (Ice-Pick Lodge)', 'game', ['russian-theatre']),
]

GEORGIAN_ARTS = [
    item('rayfield-literature-of-georgia', 'Rayfield, The Literature of Georgia', 'book', ['georgian-arts']),
    # Sturua.
    books('sturua', 'Sturua at the Rustaveli', ['georgian-arts'], [
        ('Vasadze on Sturua', True), ("Mal'tseva on Sturua's Richard III", True),
        ('The Caucasian Chalk Circle (1975)', False), ('Richard III (1979)', False)]),
    # Gabriadze.
    books('gabriadze', 'Gabriadze Marionette Theatre', ['georgian-arts', 'acting'], [
        ('Alfred and Violetta', True), ('Ramona', False), ('The Battle of Stalingrad', False), ('A Backstage Tour', False)],
        medium='play'),
    # Places to see and walk.
    books('georgian-stages', 'Live Shows in Tbilisi', ['georgian-arts'], [
        ('Rustaveli Theatre', True), ('Marjanishvili Theatre', True),
        ('Tbilisi International Festival of Theatre (September–October)', False)], medium='visit'),
    books('art-palace', 'The Art Palace: Stage-Design Sketches', ['georgian-arts', 'sets'], [
        ("Gamrekeli's Stairs", True), ("Otskheli's Othello", False)], medium='visit'),
    item('pirosmani-art-museum', 'Pirosmani at the Art Museum of Georgia', 'visit', ['georgian-arts']),
    books('places-to-walk-as-levels', 'Places to Walk as Levels', ['georgian-arts', 'sets'], [
        ('Vardzia', False), ('Uplistsikhe', False), ('The Svan Towers', False), ('David Gareja', False),
        ("Tbilisi's Balconied Courtyards", False)], medium='visit'),
    # Music.
    books('georgian-polyphony', 'Georgian Polyphony', ['georgian-arts', 'sound'], [
        ('Anchiskhati Choir, Polyphonic Voices of Georgia', True), ('The Rustavi Ensemble', False),
        ('Kancheli, Themes from the Songbook', True), ('polyphony.ge Bulletins', False)], medium='album'),
    # Literature.
    books('knight-in-the-panthers-skin', "Rustaveli, The Knight in the Panther's Skin", ['georgian-arts'], [
        ("Coffin's Rhymed Translation", False), ("Wardrop's Translation", False)], rule='n:1'),
    item('vazha-pshavela', 'Vazha-Pshavela', 'book', ['georgian-arts']),
    item('kvachi', 'Kvachi', 'book', ['georgian-arts']),
    item('vano-and-niko', 'Vano and Niko', 'book', ['georgian-arts']),
]

# Each discipline: one book, one game-side source, three games, and its exercises (the page's "Do" is core).
DISCIPLINES = [
    ('scene-dramaturgy', 'Scene Dramaturgy', ref('ball-backwards-and-forwards'), 'Ingold, "Sparkling Dialogue"',
     ['Pathologic 2', 'Kentucky Route Zero', 'Disco Elysium'], 1, [
         'Analyse One Disco Elysium or Pentiment Scene Backwards',
         'Rewrite a Dialogue as Accept, Reject or Deflect, With One Loop and One Exit',
         'Build a Room That Shows What Happened There With No Text',
         'Write a Chorus That Recaps One Day of Your Prototype as a Mime']),
    ('staging', 'Staging and Blocking', ref('hodge-mclain-play-directing'),
     'Totten, An Architectural Approach to Level Design, and Steve Lee (GDC 2017)', ['Hitman', 'Half-Life 2', 'Dishonored'], 3, [
         'Mark the Stage Areas of a Room and Place Three NPCs',
         "Draw the Level as Lynch's Five Elements, With Prospect and Refuge",
         'Play a Half-Life 2 Chapter With Commentary and Log Where Your Eye Was Guided',
         "Write a Blocking Chart of Five NPCs' Schedules"]),
    ('atmosphere', 'Mood and Atmosphere', ref('michael-chekhov-to-the-actor'), 'Kasavin, "Creating Atmosphere in Games"',
     ['Bastion', 'Alan Wake 2', 'Inside'], 1, [
         'One Sentence of Tone and One of Theme per Level',
         'One Adjective, Then the Same Action in Two Opposite Atmospheres',
         'Greybox a Corner, a Cellar and an Attic', 'Recolour the Dominant Hue and Playtest']),
    ('lighting', 'Lighting', 'Pilbrow, Stage Lighting Design', 'Ding, "Lighting of The Last of Us"',
     ['The Last of Us', 'Inside', 'Control'], 2, [
         'Rebuild a Concept Painting With One Key Light', 'The Same Room Lit for Noon, Noir and Candlelight',
         "Craig's Drill: One Set, Four Moods", 'A Commentary Walk Through Half-Life 2, Noting Where Light Steers']),
    ('sound', 'Sound and Music', 'Chion, Audio-Vision', 'Bridgett, Leading with Sound', ['Journey', 'Hades', 'Outer Wilds'], 3, [
         "Chion's Masking: Sound Only, Image Only, Then Both", 'Score a Level Three Ways',
         "Bridgett's Audit: Why Each Sound Category Is There", 'The Promenade: A Traversal Theme and Two Variations',
         'A Drone Plus Two State-Driven Layers', 'A Walk Noting How Sound Lines Up With the Pacing']),
    ('costume', 'Costume and Readability', 'Landis, FilmCraft: Costume Design', "Valve's Team Fortress 2 Paper and GDC 2008 Deck",
     ['Team Fortress 2', 'Overwatch', 'Hades'], 0, [
         'Silhouettes in Solid Black at Three Distances and Three Angles', 'The Read Order at 50 m, 10 m and 1 m',
         'Three Factions From One Decade', "What Each Garment Says About the Character's Past"]),
    ('sets', 'Sets and Level Design', 'Totten, An Architectural Approach to Level Design', 'Carson, "Environmental Storytelling"',
     ['Journey', 'Dark Souls', 'Outer Wilds'], 5, [
         'A Lynch Map, Then a Wayfinding Test With No HUD', 'A Prospect and Refuge Pass',
         "Carson's Test: Can a Tester Narrate a Dressed Room?", 'One Concept Sketch and a Three-Colour Palette Before Greyboxing',
         'Five Movable Abstract Planes, After Craig', "Popova's Drill: Verbs First"]),
    ('acting', 'Acting and Performance', 'Hooks, Acting for Animators',
     "Hooks's Course Page and Gibson's Overwatch Animation Talk", ['Shadow of the Colossus', 'Inside', 'The Last of Us'], 0, [
         'One Dominant Laban Effort per Character', 'A Six-Line Exchange Where Status Flips Twice',
         'The Same Walk Cycle at Tension Levels 2, 4 and 6', 'A Protagonist With No Facial Animation',
         'A Psychological Gesture per Character', 'What Each Cutscene Pushes, Blocks or Denies']),
]


def stagecraft():
    out = []
    for tag, name, read, bridge, games, do, exercises in DISCIPLINES:
        kids = []
        if isinstance(read, str):
            kids.append(child(f'Read {read}', 'book', core=True, id=f'{tag}-read'))
        kids.append(child(f'Bridge: {bridge}', 'book', core=True, id=f'{tag}-bridge'))
        kids += [child(f'Play {g}', 'game', core=True, id=f'{tag}-play-{slug(g)}') for g in games]
        kids += [child(e, 'exercise', core=i == do, id=f'{tag}-exercise-{chr(97 + i)}') for i, e in enumerate(exercises)]
        out.append(item(f'stagecraft-{tag}', name, 'exercise', [tag], kind='practice', children=kids))
        # A discipline whose book another track already holds lists it there, read alongside.
        if not isinstance(read, str):
            out.append(read)
    out.append(item('vertical-slice', 'Vertical Slice: Three Linked Stages', 'artefact', ['ship-a-stage'], kind='ship'))
    return out


def theatre_week(id, play, production, film, game, chapter, make, tags):
    w = f'theatre-week-{id}'
    return item(w, f'Theatre Week: {play}', 'play', tags, kind='practice', rule='all', children=[
        child(f"Read {play} With Ball's Method", 'play', core=True, id=f'{w}-read'),
        child(production, 'play', core=True, id=f'{w}-production'),
        child(film, 'film', core=True, id=f'{w}-film'),
        child(game, 'game', core=True, id=f'{w}-game'),
        child(chapter, 'book', core=True, id=f'{w}-chapter'),
        child(make, 'exercise', core=True, id=f'{w}-make'),
        child("Write One Page With the Five Passes and Choose Next Week", 'exercise', core=True, id=f'{w}-write'),
    ])


# The weeks the page pairs; the rest of the plays are listed above, to pair as you go.
THEATRE_WEEKS = [
    theatre_week('three-sisters', 'Three Sisters', "Watch Kulyabin's Three Sisters (Kanopy)", 'Watch Iosseliani, Falling Leaves',
                 'Play Pathologic 2 Through the Atmosphere Lens', 'Read M. Chekhov, To the Actor, Chapter 4',
                 'Stage One NPC Action in Two Opposite Atmospheres', ['russian-theatre', 'atmosphere']),
    theatre_week('chalk-circle', 'The Caucasian Chalk Circle', "Read About Sturua's Chalk Circle", 'Watch a Related Film',
                 'Play the Theatre Scenes in Pathologic 2', 'Read Brecht, "Short Description of a New Technique of Acting"',
                 "Build the Week's Exercise", ['georgian-arts', 'theatre-theory']),
    theatre_week('government-inspector', 'The Government Inspector', 'Watch a Recorded Staging', 'Watch a Related Film',
                 'Play Disco Elysium', "Read Ball on the Single-Premise Engine", "Build the Week's Exercise",
                 ['russian-theatre', 'scene-dramaturgy']),
]


LITERATURE = [
    # The literature spine. Adler's own list is its own tree, under Mental.
    books('bauer-well-educated-mind', 'Bauer, The Well-Educated Mind', ['literature'], [
        ('The Method: Grammar, Logic, Rhetoric', True), ('Novels', False), ('Autobiography', False), ('History', False),
        ('Drama', False), ('Poetry', False), ('Science (2016 Edition)', False)]),
    item('adler-how-to-read-a-book', 'Adler, How to Read a Book', 'book', ['literature']),
    item('bloom-western-canon', 'Bloom, The Western Canon (as a Map)', 'book', ['literature']),
    books('arts-guides', 'Visual Art and Music', ['literature'], [
        ('Gombrich, The Story of Art', False), ('Berger, Ways of Seeing', False),
        ('Copland, What to Listen for in Music', False), ('Ross, The Rest Is Noise', False)]),
    ref('mcloud-understanding-comics'),
]

# The larger milestones of practice. The monthly stage is a habit; quarters and years are not periods.
PRACTICE = [
    *[item(f'jam-{q}', f'Game Jam, Quarter {q}', 'artefact', ['ship-a-stage'], kind='ship', rule='all', children=[
        child('Enter Ludum Dare or GMTK', 'artefact', core=True, id=f'jam-{q}-enter'),
        child('Write the Postmortem', 'artefact', core=True, id=f'jam-{q}-postmortem'),
    ]) for q in range(1, 5)],
    item('one-small-finished-game', 'One Small Finished Game', 'artefact', ['finished-game'], kind='ship'),
]


def node(id, name, icon, after=None, count=None, kind=None, extra=None):
    requires = []
    if after:
        requires.append({'node': after})
    if count:
        requires.append({'count': {'min': count, **(extra or {})}})
    return {'id': id, 'name': name, 'icon': icon, 'kind': kind, 'requires': requires}


TREE = {
    'id': 'director',
    'name': 'Game Director',
    'mount': 'mastery/practical',
    'nodes': [
        node('root', 'Keep One Journal', 'notebook', kind='root'),
        # Games.
        node('foundations', 'Game Design Foundations', 'device-gamepad-2', ['root'], 3),
        node('design-craft', 'Design Craft', 'tools', ['foundations'], 2),
        node('narrative', 'Narrative Design', 'writing', ['foundations'], 2),
        node('play-literacy', 'Play Literacy', 'trophy', ['root'], 10),
        node('close-reading', 'Close Reading', 'eye', ['play-literacy'], 2),
        node('directors-intake', 'How Directors Learned', 'user-star', ['close-reading'], 1),
        # Film.
        node('film-craft', 'Film Craft', 'movie', ['root'], 3),
        node('film-canon', 'Film Canon', 'books', ['film-craft'], 10),
        node('soviet-film', 'Soviet Film', 'frame', ['film-craft'], 3),
        node('georgian-film', 'Georgian Film', 'map-pin', ['film-craft'], 3),
        node('montage', 'Montage', 'cut', ['soviet-film'], 2),
        node('long-take', 'Long Take', 'clock-hour-4', ['soviet-film'], 2),
        node('tableau', 'Tableau', 'layout-board', ['soviet-film', 'georgian-film'], 2),
        node('one-rule', 'One Rule, One Stage', 'directions', ['georgian-film'], 2),
        # Theatre.
        node('western-theatre', 'Western Theatre', 'masks-theater', ['root'], 3),
        node('russian-theatre', 'Russian Theatre', 'building-arch', ['root'], 3),
        node('georgian-arts', 'Georgian Theatre and Arts', 'map', ['root'], 3),
        node('theatre-theory', 'Theatre Theory', 'school', ['western-theatre'], 3),
        node('literature', 'Literature and the Arts', 'book', ['root'], 2),
        # The eight stagecraft disciplines.
        node('scene-dramaturgy', 'Scene Dramaturgy', 'message-2', ['western-theatre'], 3),
        node('staging', 'Staging and Blocking', 'walk', ['western-theatre'], 3),
        node('atmosphere', 'Mood and Atmosphere', 'sun', ['russian-theatre'], 3),
        node('lighting', 'Lighting', 'lamp', ['staging'], 3),
        node('sound', 'Sound and Music', 'music', ['atmosphere'], 3),
        node('costume', 'Costume and Readability', 'hanger', ['staging'], 3),
        node('sets', 'Sets and Level Design', 'stairs', ['staging'], 3),
        node('acting', 'Acting and Performance', 'mood-happy', ['russian-theatre'], 3),
        # What all of it is for.
        node('ship-a-stage', 'Ship a Stage', 'flag', ['design-craft', 'film-craft', 'staging'], 1, 'keystone', {'kind': 'ship'}),
        node('finished-game', 'A Small Finished Game', 'rocket', ['ship-a-stage'], 1, 'keystone', {'kind': 'ship'}),
    ],
}

# The practice rhythm, counted from what you write up: a week's game, film and theatre work, the
# week's build, the month's stage.
HABITS = [
    {'id': 'play-as-a-director', 'name': 'Play a Game as a Director', 'period': 'week', 'target': 1, 'counts': {'method': 'five-passes'}},
    {'id': 'film-weeks', 'name': 'Two Film Weeks', 'period': 'month', 'target': 2, 'counts': {'method': 'film-sheet'}},
    {'id': 'theatre-weeks', 'name': 'Two Theatre Weeks', 'period': 'month', 'target': 2, 'counts': {'method': 'ball'}},
    {'id': 'weekly-build', 'name': 'Build One Exercise', 'period': 'week', 'target': 1, 'counts': {'kind': 'Practice'}},
    {'id': 'monthly-stage', 'name': 'Finish One Playable Stage', 'period': 'month', 'target': 1, 'counts': {'kind': 'Ship'}},
]


TRACKS = [
    ('game-design', 'Game Design', GAME_DESIGN),
    ('western-film', 'Western Film', WESTERN_FILM),
    ('soviet-film', 'Soviet Film', SOVIET_FILM),
    ('georgian-film', 'Georgian Film', GEORGIAN_FILM),
    ('film-weeks', 'Film Weeks', film_weeks()),
    ('western-theatre', 'Western Theatre', WESTERN_THEATRE),
    ('russian-theatre', 'Russian Theatre', RUSSIAN_THEATRE),
    ('georgian-theatre', 'Georgian Theatre and Arts', GEORGIAN_ARTS),
    ('stagecraft', 'Stagecraft', stagecraft()),
    ('theatre-weeks', 'Theatre Weeks', THEATRE_WEEKS),
    ('literature', 'Literature and the Arts', LITERATURE),
    ('practice', 'Practice', PRACTICE),
]


def write():
    ids = set()
    lines = [
        '# A game director\'s self-education: the curriculum page\'s tracks, as one goal.',
        '# Generated by gen_director.py from the lists in it; edit those and run it again.',
        '# Import with "Import the game director curriculum (196 entries)", or drop the file on a board.',
        'goal: director',
        'name: Game director',
        '',
        'tracks:',
    ]
    for track_id, name, items in TRACKS:
        lines += [f'  - id: {track_id}', f'    name: {q(name)}', '    state: active', '    items:']
        for it in items:
            if 'ref' in it:
                lines.append(f'      - {it["ref"]}')
                continue
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
    print(f'{OUT}: {len(ids)} items')


if __name__ == '__main__':
    write()
