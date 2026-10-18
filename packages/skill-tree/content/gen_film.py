"""Writes film.yaml, the film tree of the game director's self-education, from the lists below.

The director curriculum (gen_director.py) is being split into three trees, film, theatre and games,
each built the way Adler's is: a skill node is a school or an era, an entry is a person, its works
are what they made. This is the film one. The canon lists (Scorsese's 39, the Sight & Sound
directors' poll) come from gen_director.py, merged and sorted by director and era. Russian and
Georgian directors and works go by their own names, as the user reads both and looks them up by them;
Georgian titles and years as Georgian Wikipedia gives them (checked 2026-10-18).
Run `python3 gen_film.py` here after editing; the YAML is what ships.
"""

import json
import re

from gen_director import SCORSESE, SIGHT_AND_SOUND

OUT = 'film.yaml'


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower().replace('’', '').replace("'", '')).strip('-')


def q(text):
    return json.dumps(text, ensure_ascii=False)


def work(id, title, medium='film', core=False):
    return {'id': id, 'title': title, 'medium': medium, 'core': core}


def person(id, name, tag, works, medium='film', rule='all', kind='study'):
    """An entry: a person (or a pair), the works under them."""
    return {'id': id, 'title': name, 'kind': kind, 'medium': medium, 'tags': [tag], 'children': works, 'rule': rule}


def single(id, title, tag, medium='book', kind='study'):
    """An entry with no works: a book or a list read whole."""
    return {'id': id, 'title': title, 'kind': kind, 'medium': medium, 'tags': [tag], 'children': [], 'rule': None}


# ---------------------------------------------------------------------------------------------------
# Craft: how a film is directed, and how to read a scene.

CRAFT = [
    person('bordwell-thompson', 'Bordwell & Thompson', 'craft', [work('film-art', 'Film Art: An Introduction', 'book')], 'book'),
    person('lumet', 'Sidney Lumet', 'craft', [work('making-movies', 'Making Movies', 'book')], 'book'),
    person('mackendrick', 'Alexander Mackendrick', 'craft', [work('on-film-making', 'On Film-making', 'book')], 'book'),
    person('mamet', 'David Mamet', 'craft', [work('on-directing-film', 'On Directing Film', 'book')], 'book'),
    person('murch', 'Walter Murch', 'craft', [work('in-the-blink-of-an-eye', 'In the Blink of an Eye', 'book')], 'book'),
    person('weston', 'Judith Weston', 'craft', [work('directing-actors', 'Directing Actors', 'book')], 'book'),
    person('brook', 'Peter Brook', 'craft', [work('the-empty-space', 'The Empty Space', 'book')], 'book'),
    person('mitchell', 'Katie Mitchell', 'craft', [work('the-directors-craft', "The Director's Craft", 'book')], 'book'),
]

READING = [
    person('corrigan', 'Timothy Corrigan', 'reading', [work('writing-about-film', 'A Short Guide to Writing About Film', 'book')], 'book'),
    person('van-sijll', 'Jennifer van Sijll', 'reading', [work('cinematic-storytelling', 'Cinematic Storytelling', 'book')], 'book'),
    person('rabiger', 'Michael Rabiger', 'reading', [work('directing', 'Directing', 'book')], 'book'),
    person('block', 'Bruce Block', 'reading', [work('the-visual-story', 'The Visual Story', 'book')], 'book'),
    person('katz', 'Steven D. Katz', 'reading', [work('shot-by-shot', 'Shot by Shot', 'book')], 'book'),
    person('nitsche', 'Michael Nitsche', 'reading', [work('video-game-spaces', 'Video Game Spaces', 'book')], 'book'),
    person('every-frame-a-painting', 'Every Frame a Painting (Tony Zhou, Taylor Ramos)', 'reading', [
        work('memories-of-murder', 'Memories of Murder: Ensemble Staging', 'talk'),
        work('kurosawa-composing-movement', 'Akira Kurosawa: Composing Movement', 'talk'),
        work('editor-think-and-feel', 'How Does an Editor Think and Feel?', 'talk'),
    ], 'talk'),
    person('film-to-level', 'Film to Level: Talks', 'reading', [
        work('bellard-spatial-cinematography', 'Bellard, "Environment Design as Spatial Cinematography" (GDC 2019)', 'talk', True),
        work('hill-interactive-pacing', 'Hill, "Interactive Pacing"', 'talk'),
    ], 'talk', rule='core'),
]

# ---------------------------------------------------------------------------------------------------
# The world canon: Scorsese's 39 and the Sight & Sound directors' poll, merged, by director, each
# director in the era of the earliest of their films here. Soviet and Georgian directors join their
# own branch instead.

# Scorsese's titles that are a poll film under another name.
SAME_FILM = {
    'The Bicycle Thief': 'Bicycle Thieves',
    'The Rules of the Game': 'La Règle du jeu',
    'Breathless': 'À bout de souffle',
    'L’avventura': "L'avventura",
    'Ali: Fear Eats the Soul': 'Fear Eats the Soul',
}
# Poll directors whose films go to the Soviet or Georgian branch.
LOCAL = {'Andrei Tarkovsky', 'Dziga Vertov', 'Elem Klimov', 'Larissa Shepitko', 'Sergei M. Eisenstein', 'Sergei Paradjanov'}
# Scorsese's list has no years; these are the films' own.
SCORSESE_YEARS = {
    'Metropolis': 1927, 'Nosferatu': 1922, 'Dr. Mabuse, the Gambler': 1922, 'Napoleon': 1927, 'Grand Illusion': 1937,
    'Children of Paradise': 1945, 'Rome, Open City': 1945, 'Paisan': 1946, 'La Terra Trema': 1948, 'Umberto D': 1952,
    'Beauty and the Beast': 1946, 'Ugetsu': 1953, 'Sansho the Bailiff': 1954, 'High and Low': 1963,
    'Big Deal on Madonna Street': 1958, 'Rocco and His Brothers': 1960, 'Shoot the Piano Player': 1960,
    'Band of Outsiders': 1964, 'Il Sorpasso': 1962, 'Blow-Up': 1966, 'Before the Revolution': 1964, 'Le Boucher': 1970,
    'Weekend': 1967, 'Death by Hanging': 1968, 'The Merchant of Four Seasons': 1971, 'The Marriage of Maria Braun': 1979,
    'Kings of the Road': 1976, 'The American Friend': 1977, 'The Mystery of Kaspar Hauser': 1974,
    'Aguirre, the Wrath of God': 1972,
}
# Each canon director's school or region: a skill node of about a dozen, so no cluster is a starburst
# of single films. The silent era stays an era.
SCHOOL = {
    'silent': ['Abel Gance', 'Carl Th. Dreyer', 'F.W. Murnau', 'Fritz Lang'],
    'hollywood': ['Alfred Hitchcock', 'Billy Wilder', 'Charles Chaplin', 'Charles Laughton', 'Gene Kelly, Stanley Donen',
                  'John Ford', 'Orson Welles', 'Maya Deren, Alexander Hackenschmied', 'David Lean', 'Michael Powell, Emeric Pressburger'],
    'japanese': ['Akira Kurosawa', 'Kenji Mizoguchi', 'Yasujirō Ozu', 'Nagisa Ōshima'],
    'italian': ['Roberto Rossellini', 'Vittorio De Sica', 'Luchino Visconti', 'Federico Fellini', 'Mario Monicelli', 'Dino Risi',
                'Michelangelo Antonioni', 'Pier Paolo Pasolini', 'Bernardo Bertolucci', 'Sergio Leone', 'Gillo Pontecorvo'],
    'french': ['Jean Renoir', 'Jean Vigo', 'Marcel Carné', 'Jean Cocteau', 'Robert Bresson', 'Jacques Tati'],
    'new-wave': ['François Truffaut', 'Jean-Luc Godard', 'Agnès Varda', 'Chris Marker', 'Claude Chabrol', 'Jean Eustache',
                 'Chantal Akerman', 'Claire Denis', 'Claude Lanzmann', 'Michel Gondry'],
    'european': ['Ingmar Bergman', 'Luis Buñuel', 'Rainer Werner Fassbinder', 'Wim Wenders', 'Werner Herzog', 'Víctor Erice',
                 'Ken Loach', 'Nicolas Roeg', 'Roman Polanski', 'Béla Tarr', 'Michael Haneke'],
    'american': ['Stanley Kubrick', 'Francis Ford Coppola', 'Martin Scorsese', 'John Cassavetes', 'Barbara Loden', 'Steven Spielberg',
                 'David Lynch', 'Ridley Scott', 'Spike Lee', 'Barry Jenkins'],
    'world': ['Satyajit Ray', 'Djibril Diop Mambéty', 'Abbas Kiarostami', 'Asghar Farhadi', 'Wong Kar Wai', 'Edward Yang',
              'Apichatpong Weerasethakul', 'Bong Joon-ho', 'Lucrecia Martel', 'Jane Campion'],
}
SCHOOL_OF = {d: school for school, ds in SCHOOL.items() for d in ds}


def canon():
    films = {}  # (director, title) -> year
    for _, title, year, director in SIGHT_AND_SOUND:
        if director not in LOCAL:
            films[(director, title)] = year
    for title, director in SCORSESE:
        title = SAME_FILM.get(title, title)
        if any(t == title for (_, t) in films):
            continue
        films[(director, title)] = SCORSESE_YEARS[title]
    by_director = {}
    for (director, title), year in films.items():
        by_director.setdefault(director, []).append((year, title))
    missing = sorted(set(by_director) - set(SCHOOL_OF))
    assert not missing, missing
    entries = []
    # Chronological within each school, by each director's earliest film here.
    for school in SCHOOL:
        for director in sorted((d for d in by_director if SCHOOL_OF[d] == school), key=lambda d: (min(by_director[d])[0], d)):
            list_ = sorted(by_director[director])
            entries.append(person(slug(director), director, school, [work(f'{slug(t)}-{y}', f'{t} ({y})') for y, t in list_]))
    return entries


CANON = [single('1001-movies', '1001 Movies You Must See Before You Die (ed. Schneider)', 'canon'), *canon()]

# ---------------------------------------------------------------------------------------------------
# Soviet film, by school. The page's tiers, put under their directors.

SOVIET = [
    person('beumers', 'Birgit Beumers', 'soviet', [work('history-of-russian-cinema', 'A History of Russian Cinema', 'book')], 'book'),
    # The montage school.
    person('eisenstein', 'Сергей Эйзенштейн', 'montage-school', [
        work('stachka', 'Стачка (1925)'),
        work('bronenosets-potemkin', 'Броненосец «Потёмкин» (1925)', core=True),
        work('oktyabr', 'Октябрь (1927)'),
        work('aleksandr-nevsky', 'Александр Невский (1938)'),
        work('ivan-grozny-1', '«Иван Грозный», 1-я серия (1944)', core=True),
        work('ivan-grozny-2', '«Иван Грозный», 2-я серия (1958)', core=True),
        work('film-form', 'Film Form and The Film Sense', 'book'),
        work('selected-works', 'Selected Works 1–4 (ed. Taylor)', 'book'),
    ], rule='core'),
    person('vertov', 'Дзига Вертов', 'montage-school', [
        work('chelovek-s-kinoapparatom', 'Человек с киноаппаратом (1929)', core=True),
        work('kino-eye', 'Kino-Eye: The Writings of Dziga Vertov', 'book'),
    ], rule='core'),
    person('pudovkin', 'Всеволод Пудовкин', 'montage-school', [
        work('mat', 'Мать (1926)'),
        work('konets-sankt-peterburga', 'Конец Санкт-Петербурга (1927)'),
        work('potomok-chingiskhana', 'Потомок Чингисхана (1928)'),
        work('film-technique', 'Film Technique and Film Acting', 'book'),
    ]),
    person('kuleshov', 'Лев Кулешов', 'montage-school', [
        work('po-zakonu', 'По закону (1926)'),
        work('kuleshov-on-film', 'Kuleshov on Film', 'book'),
    ]),
    person('bordwell', 'David Bordwell', 'montage-school', [work('cinema-of-eisenstein', 'The Cinema of Eisenstein', 'book')], 'book'),
    # Poetic cinema: the long take, the image held.
    person('tarkovsky', 'Андрей Тарковский', 'poetic', [
        work('andrei-rublev', 'Андрей Рублёв (1966)', core=True),
        work('solyaris', 'Солярис (1972)'),
        work('zerkalo', 'Зеркало (1975)', core=True),
        work('stalker', 'Сталкер (1979)', core=True),
        work('zapechatlennoe-vremya', 'Запечатлённое время', 'book'),
    ], rule='core'),
    person('strugatsky', 'Аркадий и Борис Стругацкие', 'poetic', [work('piknik-na-obochine', 'Пикник на обочине', 'book')], 'book'),
    person('bird', 'Robert Bird', 'poetic', [work('elements-of-cinema', 'Andrei Tarkovsky: Elements of Cinema', 'book')], 'book'),
    person('kalatozov', 'Михаил Калатозов', 'poetic', [
        work('sol-svanetii', 'Соль Сванетии (1930)'),
        work('letyat-zhuravli', 'Летят журавли (1957)'),
        work('ya-kuba', 'Я — Куба (1964)'),
    ]),
    person('dovzhenko', 'Александр Довженко', 'poetic', [work('zemlya', 'Земля (1930)')]),
    person('shepitko', 'Лариса Шепитько', 'poetic', [work('voskhozhdenie', 'Восхождение (1976)')]),
    person('kozintsev', 'Григорий Козинцев', 'poetic', [work('hamlet-and-lear', 'Kozintsev on Hamlet and Lear', 'book')], 'book'),
    # Late Soviet and after.
    person('klimov', 'Элем Климов', 'late-soviet', [work('idi-i-smotri', 'Иди и смотри (1985)')]),
    person('german', 'Алексей Герман', 'late-soviet', [
        work('moy-drug-ivan-lapshin', 'Мой друг Иван Лапшин (1984)'),
        work('khrustalyov-mashinu', 'Хрусталёв, машину! (1998)'),
        work('trudno-byt-bogom', 'Трудно быть богом (2013)'),
    ]),
    person('muratova', 'Кира Муратова', 'late-soviet', [
        work('korotkie-vstrechi', 'Короткие встречи (1967)'),
        work('dolgie-provody', 'Долгие проводы (1971)'),
        work('astenichesky-sindrom', 'Астенический синдром (1989)'),
    ]),
    person('sokurov', 'Александр Сокуров', 'late-soviet', [work('russky-kovcheg', 'Русский ковчег (2002)')]),
    # Fairy tale, comedy and animation.
    person('ptushko', 'Александр Птушко', 'genre', [
        work('kamenny-tsvetok', 'Каменный цветок (1946)'),
        work('sadko', 'Садко (1953)'),
        work('ilya-muromets', 'Илья Муромец (1956)'),
    ]),
    person('gaidai', 'Леонид Гайдай', 'genre', [
        work('operatsiya-y', 'Операция «Ы» и другие приключения Шурика (1965)'),
        work('kavkazskaya-plennitsa', 'Кавказская пленница, или Новые приключения Шурика (1967)'),
        work('brilliantovaya-ruka', 'Бриллиантовая рука (1968)'),
    ]),
    person('norstein', 'Юрий Норштейн', 'genre', [
        work('tsaplya-i-zhuravl', 'Цапля и журавль (1974)'),
        work('yozhik-v-tumane', 'Ёжик в тумане (1975)'),
        work('skazka-skazok', 'Сказка сказок (1979)'),
    ]),
]

# ---------------------------------------------------------------------------------------------------
# Georgian film: the first Georgian films, the golden age, and the films since 1991.

GEORGIAN = [
    person('georgian-film-reading', 'Reading on Georgian Film', 'georgian', [
        work('discovering-georgian-cinema', 'Discovering Georgian Cinema (BAMPFA/MoMA, 2014)', 'book', True),
        work('adrian-martin-parajanov', 'Adrian Martin on Parajanov', 'book'),
        work('kinokultura-12', 'KinoKultura Special Issue 12', 'book'),
        work('dzandzava-apparatus', 'Nino Dzandzava in Apparatus', 'book'),
        work('steffen-parajanov', 'Steffen, The Cinema of Sergei Parajanov', 'book'),
        work('family-affairs-arsenal', 'Family Affairs (Arsenal Berlin)', 'book'),
        work('le-cinema-georgien', 'Radvanyi & Amiredzibi, Le Cinéma géorgien', 'book'),
    ], 'book', rule='core'),
    # The first Georgian films.
    person('nikoloz-shengelaia', 'ნიკოლოზ შენგელაია', 'early-georgian', [work('eliso', 'ელისო (1928)')]),
    person('mikaberidze', 'კოტე მიქაბერიძე', 'early-georgian', [work('chemi-bebia', 'ჩემი ბებია (1929)')]),
    # The golden age, from the 1950s to the 1980s.
    person('chkheidze', 'რეზო ჩხეიძე', 'golden-age', [work('chveni-ezo', 'ჩვენი ეზო (1956)')]),
    person('iosseliani', 'ოთარ იოსელიანი', 'golden-age', [
        work('aprili-1962', 'აპრილი (1962)'),
        work('giorgobistve', 'გიორგობისთვე (1966)', core=True),
        work('iko-shashvi-mgalobeli', 'იყო შაშვი მგალობელი (1970)', core=True),
        work('pastorali', 'პასტორალი (1976)', core=True),
    ]),
    person('kobakhidze', 'მიხეილ კობახიძე', 'golden-age', [
        work('kortsili', 'ქორწილი (1964)'),
        work('kolga', 'ქოლგა (1967)'),
        work('musikosebi', 'მუსიკოსები (1969)'),
    ]),
    person('abuladze', 'თენგიზ აბულაძე', 'golden-age', [
        work('vedreba', 'ვედრება (1967)'),
        work('natvris-khe', 'ნატვრის ხე (1977)'),
        work('monanieba', 'მონანიება (1986)', core=True),
    ], rule='core'),
    person('kokochashvili', 'მერაბ კოკოჩაშვილი', 'golden-age', [work('didi-mtsvane-veli', 'დიდი მწვანე ველი (1967)')]),
    person('danelia', 'გიორგი დანელია', 'golden-age', [
        work('ar-daidardo', 'არ იდარდო! (1969)'),
        work('mimino', 'მიმინო (1977)'),
        work('kin-dza-dza', 'Кин-дза-дза! (1986)'),
    ]),
    person('giorgi-shengelaia', 'გიორგი შენგელაია', 'golden-age', [work('pirosmani', 'ფიროსმანი (1969)')]),
    person('parajanov', 'სერგო ფარაჯანოვი', 'golden-age', [
        work('tsvet-granata', 'Цвет граната (1968)', core=True),
        work('suramis-tsikhe', 'ამბავი სურამის ციხისა (1985)', core=True),
        work('arabeskebi', 'არაბესკები ფიროსმანის თემაზე (1985)'),
        work('ashik-keribi', 'აშიკ-ქერიბი (1988)'),
    ], rule='core'),
    person('eldar-shengelaia', 'ელდარ შენგელაია', 'golden-age', [
        work('sherekilebi', 'შერეკილები (1974)'),
        work('tsisferi-mtebi', 'ცისფერი მთები, ანუ დაუჯერებელი ამბავი (1984)', core=True),
    ]),
    person('rekhviashvili', 'ალექსანდრე რეხვიაშვილი', 'golden-age', [work('kartuli-kronika', 'XIX საუკუნის ქართული ქრონიკა (1978)')]),
    # Since 1991.
    person('babluani', 'გელა ბაბლუანი', 'new-georgian', [work('13-tzameti', '13 Tzameti (2005)')]),
    person('ekvtimishvili-gross', 'ნანა ექვთიმიშვილი და სიმონ გროსი', 'new-georgian', [
        work('grdzeli-nateli-dgeebi', 'გრძელი ნათელი დღეები (2013)'),
        work('chemi-bednieri-ojakhi', 'ჩემი ბედნიერი ოჯახი (2017)'),
    ]),
    person('urushadze', 'ზაზა ურუშაძე', 'new-georgian', [work('mandarinebi', 'მანდარინები (2013)')]),
    person('ovashvili', 'გიორგი ოვაშვილი', 'new-georgian', [work('simindis-kundzuli', 'სიმინდის კუნძული (2014)')]),
    person('oneli', 'რატი ონელი', 'new-georgian', [work('mzis-kalaki', 'მზის ქალაქი (2017)')]),
    person('akin', 'ლევან აკინი', 'new-georgian', [work('da-chven-vitsekvet', 'და ჩვენ ვიცეკვეთ (2019)')]),
    person('kulumbegashvili', 'დეა ყულუმბეგაშვილი', 'new-georgian', [
        work('dasatskisi', 'დასაწყისი (2020)', core=True),
        work('aprili-2024', 'აპრილი (2024)'),
    ]),
    person('koberidze', 'ალექსანდრე კობერიძე', 'new-georgian', [
        work('ras-vkhedavt', 'რას ვხედავთ, როცა ცას ვუყურებთ? (2021)', core=True),
        work('khmeli-potoli', 'ხმელი ფოთოლი (2025)'),
    ]),
    person('kotetishvili', 'თატო კოტეტიშვილი', 'new-georgian', [work('tsminda-elektroenergia', 'წმინდა ელექტროენერგია (2024)')]),
]

# ---------------------------------------------------------------------------------------------------
# Film weeks, as the page runs them: the month's school, two films a month, the rotation run twice.
# Each is its own entry with its seven steps; the paired game is named only where the page names one.

WEEKS = [
    ('montage', 'Броненосец «Потёмкин»', 'a game whose cuts and level transitions you want to study'),
    ('montage', 'Стачка', None),
    ('tableau', 'Цвет граната', 'Pathologic 2'),
    ('tableau', 'ამბავი სურამის ციხისა', None),
    ('long-take', 'Сталкер', 'S.T.A.L.K.E.R.: Shadow of Chernobyl'),
    ('long-take', 'Зеркало', None),
    ('one-rule', 'ცისფერი მთები', 'Papers, Please'),
    ('one-rule', 'გიორგობისთვე', None),
    ('montage', 'Октябрь', 'a game whose cuts and level transitions you want to study'),
    ('montage', 'Александр Невский', None),
    ('tableau', 'ფიროსმანი', None),
    ('tableau', 'Иван Грозный', 'Pathologic 2'),
    ('long-take', 'დასაწყისი', None),
    ('long-take', 'Русский ковчег', None),
    ('one-rule', 'აპრილი (1962)', None),
    ('one-rule', 'A Kobakhidze Short', None),
]


def weeks():
    out = []
    for n, (school, title, game) in enumerate(WEEKS, 1):
        w = f'week-{n:02d}'
        out.append({
            'id': w, 'title': f'Film Week {n}: {title}', 'kind': 'practice', 'medium': 'film', 'tags': [school], 'rule': 'all',
            'children': [
                work(f'{w}-watch', f'Watch {title} Once, With No Notes', 'film', True),
                work(f'{w}-log', 'Rewatch and Log One Scene (Sheet 1–3)', 'exercise', True),
                work(f'{w}-analyse', "Fill In the School's Panel and Where to Look (Sheet 4–5)", 'exercise', True),
                work(f'{w}-game', f'Play {game}' if game else 'Play the Paired Game', 'game', True),
                work(f'{w}-build', 'Build the Scene From Its Beat Sheet (Sheet 6)', 'exercise', True),
                work(f'{w}-playtest', 'Playtest With Two People', 'exercise', True),
                work(f'{w}-verdict', 'Write the Verdict (Sheet 7)', 'exercise', True),
            ],
        })
    return out


# ---------------------------------------------------------------------------------------------------


def node(id, name, icon, after=None, count=None, kind=None, extra=None):
    requires = []
    if after:
        requires.append({'node': after})
    if count:
        requires.append({'count': {'min': count, **(extra or {})}})
    return {'id': id, 'name': name, 'icon': icon, 'kind': kind, 'requires': requires}


TREE = {
    'id': 'film',
    'name': 'Film',
    'mount': 'mastery/practical',
    'nodes': [
        node('root', 'Watch Like a Director', 'movie', kind='root'),
        node('craft', 'Film Craft', 'camera', ['root'], 3),
        node('reading', 'Reading a Scene', 'eye', ['craft'], 2),
        # The world canon, by school and region.
        node('canon', 'World Canon', 'world', ['craft'], 1),
        node('silent', 'The Silent Era', 'player-play', ['canon'], 2),
        node('hollywood', 'Classical Hollywood', 'movie', ['canon'], 3),
        node('japanese', 'Japanese Masters', 'sun', ['canon'], 3),
        node('italian', 'Italian Cinema', 'building-arch', ['canon'], 3),
        node('french', 'Classical French Cinema', 'video', ['canon'], 3),
        node('new-wave', 'The New Wave and After', 'wave-sine', ['canon'], 3),
        node('european', 'European Auteurs', 'compass', ['canon'], 3),
        node('american', 'New Hollywood and After', 'device-tv', ['canon'], 3),
        node('world', 'World Cinema', 'world', ['canon'], 3),
        # Soviet film, by school.
        node('soviet', 'Soviet Film', 'frame', ['craft'], 1),
        node('montage-school', 'The Montage School', 'cut', ['soviet'], 3),
        node('poetic', 'Poetic Cinema', 'feather', ['soviet'], 3),
        node('late-soviet', 'Late Soviet and After', 'clock-hour-4', ['soviet'], 2),
        node('genre', 'Fairy Tale, Comedy and Animation', 'mood-smile', ['soviet'], 2),
        # Georgian film.
        node('georgian', 'Georgian Film', 'map-pin', ['craft'], 1),
        node('early-georgian', 'The First Georgian Films', 'mountain', ['georgian'], 1),
        node('golden-age', 'The Golden Age', 'sun', ['georgian'], 3),
        node('new-georgian', 'Georgian Film Since 1991', 'sparkles', ['georgian'], 2),
        # The film weeks, by the four schools they rotate through.
        node('weeks', 'Film Weeks', 'calendar', ['reading']),
        node('montage', 'Montage', 'cut', ['weeks'], 1, extra={'kind': 'practice'}),
        node('tableau', 'Tableau', 'layout-board', ['weeks'], 1, extra={'kind': 'practice'}),
        node('long-take', 'Long Take', 'clock-hour-4', ['weeks'], 1, extra={'kind': 'practice'}),
        node('one-rule', 'One Rule, One Stage', 'directions', ['weeks'], 1, extra={'kind': 'practice'}),
    ],
}

HABITS = [
    {'id': 'film-weeks', 'name': 'Two Film Weeks', 'period': 'month', 'target': 2, 'counts': {'method': 'film-sheet'}},
]

TRACKS = [
    ('craft', 'Film Craft', CRAFT + READING),
    ('canon', 'World Canon', CANON),
    ('soviet', 'Soviet Film', SOVIET),
    ('georgian', 'Georgian Film', GEORGIAN),
    ('weeks', 'Film Weeks', weeks()),
]


def write():
    ids = set()
    lines = [
        '# Film, one of the three trees of the game director\'s self-education (theatre and games follow).',
        '# Generated by gen_film.py; edit the lists there and run it again.',
        'goal: film',
        'name: Film',
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
                lines.append(f'        childRule: {it["rule"]}')
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
