"""Writes theatre.yaml, the theatre tree of the game director's self-education.

The second of the three trees the director curriculum (gen_director.py) is split into, built the way
Adler's is: a skill node is a tradition, an era or a discipline, an entry is a person, its works are
what they wrote or staged. Russian and Georgian people and works go by their own names (checked
against Georgian and Russian sources, 2026-10-18). Run `python3 gen_theatre.py` here after editing.
"""

import json
import re

OUT = 'theatre.yaml'


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower().replace('’', '').replace("'", '')).strip('-')


def q(text):
    return json.dumps(text, ensure_ascii=False)


def work(id, title, medium='book', core=False):
    return {'id': id, 'title': title, 'medium': medium, 'core': core}


def person(id, name, tag, works, medium='book', rule='all', kind='study'):
    return {'id': id, 'title': name, 'kind': kind, 'medium': medium, 'tags': [tag], 'children': works, 'rule': rule}


def plays(id, name, tag, titles):
    """A playwright and their plays, ids from the titles."""
    return person(id, name, tag, [work(slug(t) or f'play-{i}', t, 'play') for i, t in enumerate(titles)], 'play')


# ---------------------------------------------------------------------------------------------------
# Directing, and the lists the plays come from.

DIRECTING = [
    person('david-ball', 'David Ball', 'directing', [work('backwards-and-forwards', 'Backwards & Forwards', core=True)]),
    person('hodge-mclain', 'Francis Hodge & Michael McLain', 'directing', [work('play-directing', 'Play Directing')]),
    person('james-thomas', 'James Thomas', 'directing', [work('script-analysis', 'Script Analysis for Actors, Directors, and Designers')]),
    person('clurman', 'Harold Clurman', 'directing', [work('on-directing', 'On Directing')]),
    person('william-ball', 'William Ball', 'directing', [work('a-sense-of-direction', 'A Sense of Direction')]),
]

CANON = [
    person('billington', 'Michael Billington', 'canon', [work('101-greatest-plays', 'The 101 Greatest Plays')]),
    person('norton-drama', 'The Norton Anthology of Drama', 'canon', [work('shorter-3rd', 'Shorter, 3rd edition')]),
    person('national-theatre', 'The National Theatre', 'canon', [work('nt2000', 'The NT2000 List')]),
    # The plays: the page's first 25 (on at least two of the three lists) and the plays that show
    # their own rules, by playwright and era.
    plays('sophocles', 'Sophocles', 'greek-renaissance', ['Oedipus the King']),
    plays('shakespeare', 'William Shakespeare', 'greek-renaissance', ['Hamlet', 'Twelfth Night', 'Macbeth']),
    plays('moliere', 'Molière', 'greek-renaissance', ['Tartuffe']),
    plays('buchner', 'Georg Büchner', 'modern-drama', ['Woyzeck']),
    plays('ibsen', 'Henrik Ibsen', 'modern-drama', ["A Doll's House"]),
    plays('wilde', 'Oscar Wilde', 'modern-drama', ['The Importance of Being Earnest']),
    plays('shaw', 'George Bernard Shaw', 'modern-drama', ['Pygmalion']),
    plays('pirandello', 'Luigi Pirandello', 'modern-drama', ['Six Characters in Search of an Author']),
    plays('ocasey', "Seán O'Casey", 'modern-drama', ['Juno and the Paycock']),
    plays('treadwell', 'Sophie Treadwell', 'modern-drama', ['Machinal']),
    plays('hecht-macarthur', 'Ben Hecht & Charles MacArthur', 'modern-drama', ['The Front Page']),
    plays('priestley', 'J. B. Priestley', 'modern-drama', ['An Inspector Calls']),
    plays('oneill', "Eugene O'Neill", 'modern-drama', ["Long Day's Journey into Night"]),
    plays('williams', 'Tennessee Williams', 'postwar', ['A Streetcar Named Desire']),
    plays('miller', 'Arthur Miller', 'postwar', ['Death of a Salesman or The Crucible']),
    plays('stewart', 'Ena Lamont Stewart', 'postwar', ['Men Should Weep']),
    plays('beckett', 'Samuel Beckett', 'postwar', ['Waiting for Godot']),
    plays('rattigan', 'Terence Rattigan', 'postwar', ['The Deep Blue Sea']),
    plays('hansberry', 'Lorraine Hansberry', 'postwar', ['A Raisin in the Sun']),
    plays('arden', 'John Arden', 'postwar', ["Serjeant Musgrave's Dance"]),
    plays('pinter', 'Harold Pinter', 'postwar', ['The Homecoming or The Caretaker']),
    plays('stoppard', 'Tom Stoppard', 'postwar', ['Rosencrantz and Guildenstern Are Dead']),
    plays('frayn', 'Michael Frayn', 'postwar', ['Noises Off']),
    plays('churchill', 'Caryl Churchill', 'contemporary-drama', ['Top Girls']),
    plays('soyinka', 'Wole Soyinka', 'contemporary-drama', ["Death and the King's Horseman"]),
    plays('august-wilson', 'August Wilson', 'contemporary-drama', ['Fences']),
    plays('hare', 'David Hare', 'contemporary-drama', ['Racing Demon']),
    plays('kushner', 'Tony Kushner', 'contemporary-drama', ['Angels in America']),
]

# ---------------------------------------------------------------------------------------------------
# Theory, the stage's designers, and theatre meeting games.

THEORY = [
    person('brecht', 'Bertolt Brecht', 'theory', [work('short-description', '"Short Description of a New Technique of Acting"', core=True)]),
    person('artaud', 'Antonin Artaud', 'theory', [work('theatre-and-its-double', 'The Theatre and Its Double')]),
    person('grotowski', 'Jerzy Grotowski', 'theory', [work('towards-a-poor-theatre', 'Towards a Poor Theatre', core=True)]),
    person('boal', 'Augusto Boal', 'theory', [work('games-for-actors', 'Games for Actors and Non-Actors')]),
    person('johnstone', 'Keith Johnstone', 'theory', [work('impro', 'Impro: Improvisation and the Theatre', core=True)]),
    person('spolin', 'Viola Spolin', 'theory', [work('improvisation-for-the-theater', 'Improvisation for the Theater', core=True)]),
    person('schechner', 'Richard Schechner', 'theory', [work('performance-theory', 'Performance Theory')]),
    # The page's footnotes.
    person('stella-adler', 'Stella Adler', 'theory', [work('art-of-acting', 'The Art of Acting')]),
    person('meisner', 'Sanford Meisner', 'theory', [work('on-acting', 'Sanford Meisner on Acting')]),
    person('kantor', 'Tadeusz Kantor', 'theory', [work('journey-through-other-spaces', 'A Journey Through Other Spaces')]),
]

DESIGN = [
    person('appia', 'Adolphe Appia', 'design', [work('work-of-living-art', 'The Work of Living Art')]),
    person('craig', 'Edward Gordon Craig', 'design', [work('on-the-art-of-the-theatre', 'On the Art of the Theatre')]),
    person('robert-edmond-jones', 'Robert Edmond Jones', 'design', [work('dramatic-imagination', 'The Dramatic Imagination')]),
    person('robert-wilson', 'Robert Wilson', 'design', [work('einstein-on-the-beach', 'Einstein on the Beach', 'play')], 'play'),
]

THEATRE_AND_GAMES = [
    person('laurel', 'Brenda Laurel', 'theatre-games', [work('computers-as-theatre', 'Computers as Theatre', core=True)]),
    person('emily-short', 'Emily Short', 'theatre-games', [work('punchdrunk-masterclass', 'Notes From a Punchdrunk Masterclass', core=True)]),
    person('gareth-white', 'Gareth White', 'theatre-games', [work('audience-participation', 'Audience Participation in Theatre')]),
    person('faith', 'Faith (2020)', 'theatre-games', [work('on-immersive-theatre', 'On Immersive Theatre')]),
    person('charitos-timplalexi', 'Charitos & Timplalexi (2023)', 'theatre-games', [work('theatre-gamification', '"Theatre Gamification"')]),
    person('horn', 'Horn (GDC 2021)', 'theatre-games', [work('lessons-from-theatre', '"Lessons From Theatre That Can Transform XR Experiences"', 'talk')], 'talk'),
    person('tender-claws', 'Tender Claws & Piehole (GDC 2019)', 'theatre-games', [work('live-actors-in-vr', 'Live Actors in VR', 'talk')], 'talk'),
    person('to-be-with-hamlet', 'To Be With Hamlet (GDC 2017)', 'theatre-games', [work('to-be-with-hamlet-talk', 'To Be With Hamlet', 'talk')], 'talk'),
    person('fernandez-vara', 'Clara Fernández-Vara', 'theatre-games', [work('introduction-to-game-analysis', 'Introduction to Game Analysis')]),
    person('calleja', 'Gordon Calleja', 'theatre-games', [work('in-game', 'In-Game: From Immersion to Incorporation')]),
]

# ---------------------------------------------------------------------------------------------------
# Russian theatre: Stanislavski and his heirs, the plays, the avant-garde and its theory, the music.

RUSSIAN = [
    person('skinner', 'Amy Skinner (ed.)', 'russian', [work('russian-theatre-in-practice', 'Russian Theatre in Practice')]),
    person('stanislavsky', 'Константин Станиславский', 'stanislavsky', [
        work('rabota-aktyora', 'Работа актёра над собой (An Actor’s Work, tr. Benedetti)', core=True)]),
    person('carnicke', 'Sharon Marie Carnicke', 'stanislavsky', [work('stanislavsky-in-focus', 'Stanislavsky in Focus', core=True)]),
    person('merlin', 'Bella Merlin', 'stanislavsky', [work('stanislavsky-toolkit', 'The Complete Stanislavsky Toolkit')]),
    person('mikhail-chekhov', 'Михаил Чехов', 'stanislavsky', [
        work('o-tekhnike-atmosfera', '«О технике актёра»: Атмосфера', core=True),
        work('o-tekhnike-zhest', '«О технике актёра»: Психологический жест', core=True),
    ]),
    person('efros', 'Анатолий Эфрос', 'stanislavsky', [work('repetitsiya', 'Репетиция — любовь моя (The Joy of Rehearsal)')]),
    # The plays, ranked by how well they transfer.
    plays('anton-chekhov', 'Антон Чехов', 'russian-plays', ['Вишнёвый сад', 'Три сестры']),
    plays('gogol', 'Николай Гоголь', 'russian-plays', ['Ревизор']),
    plays('erdman', 'Николай Эрдман', 'russian-plays', ['Самоубийца']),
    plays('bulgakov', 'Михаил Булгаков', 'russian-plays', ['Бег']),
    plays('schwartz', 'Евгений Шварц', 'russian-plays', ['Дракон']),
    plays('pushkin', 'Александр Пушкин', 'russian-plays', ['Борис Годунов']),
    plays('gorky', 'Максим Горький', 'russian-plays', ['На дне']),
    person('kulyabin', 'Тимофей Кулябин', 'russian-plays', [work('tri-sestry-krasny-fakel', '«Три сестры», «Красный факел» (Stage Russia, Kanopy)', 'play')], 'play'),
    # The avant-garde and the theory that came out of it.
    person('meyerhold', 'Всеволод Мейерхольд', 'avant-garde', [work('meyerhold-on-theatre', 'Meyerhold on Theatre (Pitches)')]),
    person('bowlt', 'John E. Bowlt', 'avant-garde', [work('russian-avant-garde-theatre', 'Russian Avant-Garde Theatre')]),
    person('shklovsky', 'Виктор Шкловский', 'avant-garde', [work('iskusstvo-kak-priyom', '«Искусство как приём» (остранение)', core=True)]),
    person('propp', 'Владимир Пропп', 'avant-garde', [work('morfologiya-skazki', '«Морфология сказки» (31 функция)', core=True)]),
    person('bakhtin', 'Михаил Бахтин', 'avant-garde', [
        work('khronotop', '«Формы времени и хронотопа в романе»', core=True),
        work('rable', '«Творчество Франсуа Рабле и народная культура средневековья и Ренессанса»', core=True),
    ]),
    person('ice-pick-lodge', 'Ice-Pick Lodge', 'avant-garde', [work('mor-2019', 'Мор (Pathologic 2, 2019)', 'game')], 'game'),
    # Music.
    person('maes', 'Francis Maes', 'russian-music', [work('history-of-russian-music', 'A History of Russian Music')]),
    person('rimsky-korsakov', 'Николай Римский-Корсаков', 'russian-music', [work('osnovy-orkestrovki', 'Основы оркестровки')]),
    person('mussorgsky', 'Модест Мусоргский', 'russian-music', [work('kartinki-s-vystavki', 'Картинки с выставки', 'album', True)], 'album'),
    person('prokofiev', 'Сергей Прокофьев', 'russian-music', [work('petya-i-volk', 'Петя и волк', 'album', True)], 'album'),
]

# ---------------------------------------------------------------------------------------------------
# Georgian theatre and the arts around it.

GEORGIAN = [
    person('tbilisi-stages', 'Live Shows in Tbilisi', 'georgian', [
        work('rustaveli-theatre', 'შოთა რუსთაველის სახელობის თეატრი', 'visit', True),
        work('marjanishvili-theatre', 'კოტე მარჯანიშვილის სახელობის თეატრი', 'visit', True),
        work('tbilisi-theatre-festival', 'თბილისის საერთაშორისო თეატრალური ფესტივალი (September–October)', 'visit'),
    ], 'visit', rule='core'),
    person('sturua', 'რობერტ სტურუა', 'georgian-stage', [
        work('kavkasiuri-tsartsis-tsre', 'კავკასიური ცარცის წრე (1975)', 'play'),
        work('richard-iii', 'რიჩარდ III (1979)', 'play'),
        work('vasadze-on-sturua', 'Vasadze on Sturua', 'book', True),
        work('maltseva-richard-iii', "Mal'tseva on Sturua's Richard III", 'book', True),
    ], 'play', rule='core'),
    person('gabriadze', 'რეზო გაბრიაძე', 'georgian-stage', [
        work('alfredi-da-violeta', 'ალფრედი და ვიოლეტა', 'play', True),
        work('stalingradi', 'სტალინგრადი', 'play'),
        work('ramona', 'რამონა', 'play'),
        work('backstage-tour', 'A Backstage Tour of the Marionette Theatre', 'visit'),
    ], 'play', rule='core'),
    # Stage design, and places to walk as if they were levels.
    person('gamrekeli', 'ირაკლი გამრეკელი', 'georgian-design', [work('gamrekeli-stairs', 'Gamrekeli’s stairs at the Art Palace', 'visit', True)], 'visit'),
    person('otskheli', 'პეტრე ოცხელი', 'georgian-design', [work('otskheli-othello', 'ოტელო (1933), at the Art Palace', 'visit')], 'visit'),
    person('pirosmani', 'ნიკო ფიროსმანაშვილი', 'georgian-design', [work('pirosmani-art-museum', 'At the Art Museum of Georgia', 'visit')], 'visit'),
    person('places-as-levels', 'Places to Walk as Levels', 'georgian-design', [
        work('vardzia', 'ვარძია', 'visit'), work('uplistsikhe', 'უფლისციხე', 'visit'), work('svan-towers', 'სვანური კოშკები', 'visit'),
        work('davit-gareja', 'დავით გარეჯა', 'visit'), work('tbilisi-courtyards', "Tbilisi's balconied courtyards", 'visit'),
    ], 'visit', rule=None),
    # Music.
    person('anchiskhati', 'ანჩისხატის გუნდი', 'georgian-music', [work('polyphonic-voices', 'Polyphonic Voices of Georgia', 'album', True)], 'album'),
    person('rustavi-ensemble', 'ანსამბლი „რუსთავი“', 'georgian-music', [work('rustavi-recordings', 'Recordings', 'album')], 'album'),
    person('kancheli', 'გია ყანჩელი', 'georgian-music', [work('themes-from-the-songbook', 'Themes from the Songbook', 'album', True)], 'album'),
    person('polyphony-ge', 'polyphony.ge', 'georgian-music', [work('polyphony-bulletins', 'Bulletins', 'book')]),
    # Literature.
    person('rayfield', 'Donald Rayfield', 'georgian-literature', [work('literature-of-georgia', 'The Literature of Georgia')]),
    person('rustaveli', 'შოთა რუსთაველი', 'georgian-literature', [
        work('vepkhistkaosani-coffin', 'ვეფხისტყაოსანი (Coffin’s rhymed translation)'),
        work('vepkhistkaosani-wardrop', 'ვეფხისტყაოსანი (Wardrop’s translation)'),
    ], rule='n:1'),
    person('vazha-pshavela', 'ვაჟა-ფშაველა', 'georgian-literature', [work('vazha-poems', 'Poems')]),
    person('javakhishvili', 'მიხეილ ჯავახიშვილი', 'georgian-literature', [work('kvachi', 'კვაჭი კვაჭანტირაძე')]),
    person('akhvlediani', 'ერლომ ახვლედიანი', 'georgian-literature', [work('vano-da-niko', 'ვანო და ნიკო')]),
]

# ---------------------------------------------------------------------------------------------------
# Stagecraft: eight disciplines, each its book, its source on the game side, three games to play and
# its exercises (the page's "Do" is core). Where the book is another node's, it is read there.

DISCIPLINES = [
    ('scene-dramaturgy', 'Scene Dramaturgy', None, ('Jon Ingold', '"Sparkling Dialogue"'),
     ['Pathologic 2', 'Kentucky Route Zero', 'Disco Elysium'], 1, [
         'Analyse One Disco Elysium or Pentiment Scene Backwards',
         'Rewrite a Dialogue as Accept, Reject or Deflect, With One Loop and One Exit',
         'Build a Room That Shows What Happened There With No Text',
         'Write a Chorus That Recaps One Day of Your Prototype as a Mime']),
    ('staging', 'Staging and Blocking', None, ('Christopher Totten and Steve Lee', 'An Architectural Approach to Level Design; Lee (GDC 2017)'),
     ['Hitman', 'Half-Life 2', 'Dishonored'], 3, [
         'Mark the Stage Areas of a Room and Place Three NPCs',
         "Draw the Level as Lynch's Five Elements, With Prospect and Refuge",
         'Play a Half-Life 2 Chapter With Commentary and Log Where Your Eye Was Guided',
         "Write a Blocking Chart of Five NPCs' Schedules"]),
    ('atmosphere', 'Mood and Atmosphere', None, ('Greg Kasavin', '"Creating Atmosphere in Games"'),
     ['Bastion', 'Alan Wake 2', 'Inside'], 1, [
         'One Sentence of Tone and One of Theme per Level',
         'One Adjective, Then the Same Action in Two Opposite Atmospheres',
         'Greybox a Corner, a Cellar and an Attic', 'Recolour the Dominant Hue and Playtest']),
    ('lighting', 'Lighting', ('Richard Pilbrow', 'Stage Lighting Design'), ('Ding', '"Lighting of The Last of Us"'),
     ['The Last of Us', 'Inside', 'Control'], 2, [
         'Rebuild a Concept Painting With One Key Light', 'The Same Room Lit for Noon, Noir and Candlelight',
         "Craig's Drill: One Set, Four Moods", 'A Commentary Walk Through Half-Life 2, Noting Where Light Steers']),
    ('sound', 'Sound and Music', ('Michel Chion', 'Audio-Vision'), ('Rob Bridgett', 'Leading with Sound'), ['Journey', 'Hades', 'Outer Wilds'], 3, [
         "Chion's Masking: Sound Only, Image Only, Then Both", 'Score a Level Three Ways',
         "Bridgett's Audit: Why Each Sound Category Is There", 'The Promenade: A Traversal Theme and Two Variations',
         'A Drone Plus Two State-Driven Layers', 'A Walk Noting How Sound Lines Up With the Pacing']),
    ('costume', 'Costume and Readability', ('Deborah Nadoolman Landis', 'FilmCraft: Costume Design'),
     ('Valve', 'The Team Fortress 2 paper and GDC 2008 deck'), ['Team Fortress 2', 'Overwatch', 'Hades'], 0, [
         'Silhouettes in Solid Black at Three Distances and Three Angles', 'The Read Order at 50 m, 10 m and 1 m',
         'Three Factions From One Decade', "What Each Garment Says About the Character's Past"]),
    ('sets', 'Sets and Level Design', ('Christopher Totten', 'An Architectural Approach to Level Design'), ('Don Carson', '"Environmental Storytelling"'),
     ['Journey', 'Dark Souls', 'Outer Wilds'], 5, [
         'A Lynch Map, Then a Wayfinding Test With No HUD', 'A Prospect and Refuge Pass',
         "Carson's Test: Can a Tester Narrate a Dressed Room?", 'One Concept Sketch and a Three-Colour Palette Before Greyboxing',
         'Five Movable Abstract Planes, After Craig', "Popova's Drill: Verbs First"]),
    ('acting', 'Acting and Performance', ('Ed Hooks', 'Acting for Animators'), ('Ed Hooks and David Gibson', "Hooks's course page; Gibson's Overwatch animation talk"),
     ['Shadow of the Colossus', 'Inside', 'The Last of Us'], 0, [
         'One Dominant Laban Effort per Character', 'A Six-Line Exchange Where Status Flips Twice',
         'The Same Walk Cycle at Tension Levels 2, 4 and 6', 'A Protagonist With No Facial Animation',
         'A Psychological Gesture per Character', 'What Each Cutscene Pushes, Blocks or Denies']),
]


def stagecraft():
    out = []
    for tag, name, read, bridge, games, do, exercises in DISCIPLINES:
        if read:
            author, title = read
            out.append(person(f'{tag}-read', author, tag, [work(f'{tag}-book', title, core=True)]))
        author, title = bridge
        out.append(person(f'{tag}-bridge', author, tag, [work(f'{tag}-bridge-work', title, 'talk', True)], 'talk'))
        out.append(person(f'{tag}-games', 'Games to Play', tag, [work(f'{tag}-{slug(g)}', g, 'game', True) for g in games], 'game'))
        out.append(person(f'{tag}-exercises', 'Exercises', tag,
                          [work(f'{tag}-exercise-{chr(97 + i)}', e, 'exercise', i == do) for i, e in enumerate(exercises)],
                          'exercise', rule='core', kind='practice'))
    return out


def theatre_week(n, play, production, film, game, chapter, make, tag):
    w = f'theatre-week-{n}'
    return {'id': w, 'title': f'Theatre Week {n}: {play}', 'kind': 'practice', 'medium': 'play', 'tags': [tag], 'rule': 'all', 'children': [
        work(f'{w}-read', f"Read {play} With Ball's Method", 'play', True),
        work(f'{w}-production', production, 'play', True),
        work(f'{w}-film', film, 'film', True),
        work(f'{w}-game', game, 'game', True),
        work(f'{w}-chapter', chapter, 'book', True),
        work(f'{w}-make', make, 'exercise', True),
        work(f'{w}-write', 'Write One Page With the Five Passes and Choose Next Week', 'exercise', True),
    ]}


WEEKS = [
    theatre_week(1, '«Три сестры»', 'Watch Кулябин’s «Три сестры» (Kanopy)', 'Watch გიორგობისთვე (Iosseliani)',
                 'Play Мор (Pathologic 2) Through the Atmosphere Lens', 'Read М. Чехов, «О технике актёра»: Атмосфера',
                 'Stage One NPC Action in Two Opposite Atmospheres', 'weeks'),
    theatre_week(2, 'The Caucasian Chalk Circle', 'Read About Sturua’s კავკასიური ცარცის წრე', 'Watch a Related Film',
                 'Play the Theatre Scenes in Мор (Pathologic 2)', 'Read Brecht, "Short Description of a New Technique of Acting"',
                 "Build the Week's Exercise", 'weeks'),
    theatre_week(3, '«Ревизор»', 'Watch a Recorded Staging', 'Watch a Related Film', 'Play Disco Elysium',
                 'Read Ball on the Single-Premise Engine', "Build the Week's Exercise", 'weeks'),
]

# Reading round the arts: the wider shelf the page names beside the plays.
ARTS = [
    person('bauer', 'Susan Wise Bauer', 'arts', [
        work('bauer-method', 'The Well-Educated Mind: The Method (Grammar, Logic, Rhetoric)', core=True),
        work('bauer-drama', 'The Well-Educated Mind: Drama', core=True),
    ], rule='core'),
    person('bloom', 'Harold Bloom', 'arts', [work('western-canon', 'The Western Canon (as a map)')]),
    person('gombrich', 'E. H. Gombrich', 'arts', [work('story-of-art', 'The Story of Art')]),
    person('berger', 'John Berger', 'arts', [work('ways-of-seeing', 'Ways of Seeing')]),
    person('copland', 'Aaron Copland', 'arts', [work('what-to-listen-for', 'What to Listen for in Music')]),
    person('alex-ross', 'Alex Ross', 'arts', [work('rest-is-noise', 'The Rest Is Noise')]),
]


def node(id, name, icon, after=None, count=None, kind=None, extra=None):
    requires = []
    if after:
        requires.append({'node': after})
    if count:
        requires.append({'count': {'min': count, **(extra or {})}})
    return {'id': id, 'name': name, 'icon': icon, 'kind': kind, 'requires': requires}


TREE = {
    'id': 'theatre',
    'name': 'Theatre',
    'mount': 'mastery/practical',
    'nodes': [
        node('root', 'Theatre', 'masks-theater', kind='root'),
        node('directing', 'Directing', 'speakerphone', ['root'], 2),
        node('canon', 'The Repertoire', 'books', ['root'], 1),
        node('greek-renaissance', 'Greek and Renaissance Drama', 'building-arch', ['canon'], 2),
        node('modern-drama', 'Modern Drama', 'lamp', ['canon'], 3),
        node('postwar', 'Postwar Drama', 'clock-hour-4', ['canon'], 3),
        node('contemporary-drama', 'Contemporary Drama', 'sparkles', ['canon'], 2),
        node('theory', 'Theory and Practice', 'school', ['directing'], 3),
        node('design', 'Designing the Stage', 'stairs', ['theory'], 2),
        node('theatre-games', 'Theatre Meets Games', 'device-gamepad-2', ['theory'], 2),
        # Russian theatre.
        node('russian', 'Russian Theatre', 'building-castle', ['root'], 1),
        node('stanislavsky', 'Stanislavski and His Heirs', 'mood-happy', ['russian'], 3),
        node('russian-plays', 'Russian Plays', 'book', ['russian'], 3),
        node('avant-garde', 'The Avant-Garde and Its Theory', 'triangle', ['russian'], 2),
        node('russian-music', 'Russian Music', 'music', ['russian'], 2),
        # Georgian theatre and the arts.
        node('georgian', 'Georgian Theatre', 'map-pin', ['root'], 1),
        node('georgian-stage', 'The Georgian Stage', 'masks-theater', ['georgian'], 2),
        node('georgian-design', 'Design and Places', 'mountain', ['georgian'], 2),
        node('georgian-music', 'Georgian Polyphony', 'microphone-2', ['georgian'], 2),
        node('georgian-literature', 'Georgian Literature', 'feather', ['georgian'], 2),
        # Stagecraft, discipline by discipline.
        node('stagecraft', 'Stagecraft', 'tools', ['directing']),
        node('scene-dramaturgy', 'Scene Dramaturgy', 'message-2', ['stagecraft'], 3),
        node('staging', 'Staging and Blocking', 'walk', ['stagecraft'], 3),
        node('atmosphere', 'Mood and Atmosphere', 'sun', ['stagecraft'], 3),
        node('lighting', 'Lighting', 'bulb', ['staging'], 3),
        node('sound', 'Sound and Music', 'music', ['atmosphere'], 3),
        node('costume', 'Costume and Readability', 'hanger', ['staging'], 3),
        node('sets', 'Sets and Level Design', 'stairs', ['staging'], 3),
        node('acting', 'Acting and Performance', 'mood-happy', ['stagecraft'], 3),
        node('weeks', 'Theatre Weeks', 'calendar', ['stagecraft'], 1, extra={'kind': 'practice'}),
        node('arts', 'Literature and the Arts', 'palette', ['root'], 2),
    ],
}

HABITS = [
    {'id': 'theatre-weeks', 'name': 'Two Theatre Weeks', 'period': 'month', 'target': 2, 'counts': {'method': 'ball'}},
]

TRACKS = [
    ('directing', 'Directing', DIRECTING),
    ('repertoire', 'The Repertoire', CANON),
    ('theory', 'Theory and Practice', THEORY + DESIGN + THEATRE_AND_GAMES),
    ('russian', 'Russian Theatre', RUSSIAN),
    ('georgian', 'Georgian Theatre and Arts', GEORGIAN),
    ('stagecraft', 'Stagecraft', stagecraft()),
    ('weeks', 'Theatre Weeks', WEEKS),
    ('arts', 'Literature and the Arts', ARTS),
]


def write():
    ids = set()
    lines = [
        '# Theatre, one of the three trees of the game director\'s self-education (film and games beside it).',
        '# Generated by gen_theatre.py; edit the lists there and run it again.',
        'goal: theatre',
        'name: Theatre',
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
