"""Files each album of essentials.json under a genre, and each genre under the /mu/core skill tree.

The /mu/core tree goes root -> 20 pillars (Rock, Jazz...) -> families (Metal, Punk...). This adds a
level below the families: a genre node per chart genre (Black Metal, Shoegaze, Vaporwave...), each
the tag of one new syllabus entry holding that genre's albums. A genre sits under the family
/mu/core itself files that genre in (its works' titles name their genre: "Emocore" is under
Post-Punk derived, "Grindcore" under Punk), and a family is added only where no family takes a
genre (instrumental, experimental and non-English hip hop). Charts that span every genre of a
pillar (Hip Hop 1-3, Jazz, Electronic (General)) get an "Essentials" genre on the pillar itself.

Which genre an album gets:

- Each chart row names a genre: its chart's, or for charts made of sections (Metal subgenres,
  Progressive Rock 5, Industrial 4...) its section's. Classical (General) and its sequels go by
  composer, the Traditional/Regional chart by country.
- An album on several charts takes the genre most of its rows name; on a tie, the genre with the
  fewest albums, being the most specific. Rows naming an "Essentials" genre count half, so a genre
  chart always wins over a general one.
- Albums already in /mu/core are left where they are.
- An entry with no album name is left out: a square nobody could identify, or a chart that names
  only an artist. genres.md lists the second kind, to add by hand.

    python3 organise.py          # prints the genres and their album counts, writes genres.md
    python3 organise.py --write  # also puts the genres and albums in ../mucore.yaml, in place of any
                                 # it put there before

Nodes need only their parent: unlock counts are on their way out of the app.
"""

import collections
import hashlib
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ESSENTIALS = os.path.join(HERE, 'essentials.json')
MUCORE = os.path.join(os.path.dirname(HERE), 'mucore.yaml')
GENRES_MD = os.path.join(HERE, 'genres.md')
MARK = '# --- /mu/ Essential Charts genres (organise.py) ---'

# New families, where no /mu/core family takes a genre: id -> (name, pillar).
FAMILIES = {
    'hip-hop-alternative': ('Alternative, Experimental', 'hip-hop'),
    'hip-hop-instrumental': ('Instrumental, Turntablism', 'hip-hop'),
    'hip-hop-international': ('International', 'hip-hop'),
}

# Genres: id -> (name, parent node). The parent is a /mu/core family, a new family above, a pillar
# (for "Essentials"), or a pillar-less sector node (Ancient, Central Asian).
G = {
    # Rock: Rock & Roll, Pop Rock
    'rock-and-roll': ('Rock & Roll', 'rock-rock-and-roll-pop-rock'),
    'surf': ('Surf', 'rock-rock-and-roll-pop-rock'),
    'psychobilly': ('Psychobilly', 'rock-rock-and-roll-pop-rock'),
    'power-pop': ('Power Pop', 'rock-rock-and-roll-pop-rock'),
    'soft-rock': ('Soft Rock, Yacht Rock', 'rock-rock-and-roll-pop-rock'),
    'southern-rock': ('Southern Rock', 'rock-rock-and-roll-pop-rock'),
    'baroque-pop': ('Baroque Pop', 'rock-rock-and-roll-pop-rock'),
    # Rock: Psychedelic, Hard, Progressive
    'psychedelic-rock': ('Psychedelic Rock', 'rock-psychedelic-hard-progressive'),
    'hard-rock': ('Hard Rock', 'rock-psychedelic-hard-progressive'),
    'progressive-rock': ('Progressive Rock', 'rock-psychedelic-hard-progressive'),
    'avant-prog': ('Avant-Prog', 'rock-psychedelic-hard-progressive'),
    'krautrock': ('Krautrock', 'rock-psychedelic-hard-progressive'),
    'canterbury-scene': ('Canterbury Scene', 'rock-psychedelic-hard-progressive'),
    'zeuhl': ('Zeuhl', 'rock-psychedelic-hard-progressive'),
    # Rock: Metal
    'heavy-metal': ('Heavy Metal', 'rock-metal'),
    'power-metal': ('Power Metal', 'rock-metal'),
    'thrash-metal': ('Thrash Metal', 'rock-metal'),
    'death-metal': ('Death Metal', 'rock-metal'),
    'melodic-death-metal': ('Melodic Death Metal', 'rock-metal'),
    'black-metal': ('Black Metal', 'rock-metal'),
    'depressive-black-metal': ('Depressive Black Metal', 'rock-metal'),
    'blackgaze': ('Blackgaze', 'rock-metal'),
    'doom-metal': ('Doom Metal', 'rock-metal'),
    'sludge-metal': ('Sludge Metal, Post-Metal', 'rock-metal'),
    'stoner-rock': ('Stoner Rock, Desert Rock', 'rock-metal'),
    'drone-metal': ('Drone Metal', 'rock-metal'),
    'folk-metal': ('Folk Metal, Viking Metal', 'rock-metal'),
    'symphonic-gothic-metal': ('Symphonic Metal, Gothic Metal', 'rock-metal'),
    'progressive-metal': ('Progressive Metal', 'rock-metal'),
    'avant-garde-metal': ('Avant-Garde Metal', 'rock-metal'),
    'industrial-metal': ('Industrial Metal', 'rock-metal'),
    'space-metal': ('Space Metal', 'rock-metal'),
    # Rock: Punk
    'punk-rock': ('Punk Rock', 'rock-punk'),
    'hardcore-punk': ('Hardcore Punk', 'rock-punk'),
    'pop-punk': ('Pop Punk', 'rock-punk'),
    'folk-punk': ('Folk Punk', 'rock-punk'),
    'crust-powerviolence': ('Crust, Powerviolence', 'rock-punk'),
    'grindcore': ('Grindcore', 'rock-punk'),
    'metalcore': ('Metalcore, Mathcore, Deathcore', 'rock-punk'),
    'new-wave': ('New Wave', 'rock-punk'),
    'synth-pop': ('Synth Pop', 'rock-punk'),
    # Rock: Post-Punk derived
    'post-punk': ('Post-Punk', 'rock-post-punk-derived'),
    'gothic-rock': ('Gothic Rock', 'rock-post-punk-derived'),
    'no-wave': ('No Wave', 'rock-post-punk-derived'),
    'noise-rock': ('Noise Rock', 'rock-post-punk-derived'),
    'art-punk': ('Art Punk', 'rock-post-punk-derived'),
    'dance-punk': ('Dance-Punk', 'rock-post-punk-derived'),
    'neo-psychedelia': ('Neo-Psychedelia', 'rock-post-punk-derived'),
    'dream-pop': ('Dream Pop', 'rock-post-punk-derived'),
    'neofolk': ('Neofolk', 'rock-post-punk-derived'),
    'ebm-electro-industrial': ('EBM, Electro-Industrial', 'rock-post-punk-derived'),
    'post-hardcore': ('Post-Hardcore', 'rock-post-punk-derived'),
    'emo': ('Emo, Screamo', 'rock-post-punk-derived'),
    'math-rock': ('Math Rock', 'rock-post-punk-derived'),
    # Rock: Indie, Alternative
    'alternative-rock': ('Alternative Rock', 'rock-indie-alternative'),
    'grunge': ('Grunge', 'rock-indie-alternative'),
    'britpop': ('Britpop', 'rock-indie-alternative'),
    'jangle-pop': ('Jangle Pop', 'rock-indie-alternative'),
    'twee-pop': ('Twee Pop', 'rock-indie-alternative'),
    'noise-pop': ('Noise Pop', 'rock-indie-alternative'),
    'shoegaze': ('Shoegaze', 'rock-indie-alternative'),
    'slowcore': ('Slowcore, Sadcore', 'rock-indie-alternative'),
    'post-rock': ('Post-Rock', 'rock-indie-alternative'),
    'nu-metal': ('Nu Metal, Alternative Metal', 'rock-indie-alternative'),
    'indie-pop': ('Indie Pop, Bedroom Pop', 'rock-indie-alternative'),
    'art-pop': ('Art Pop', 'rock-indie-alternative'),
    'indietronica': ('Indietronica', 'rock-indie-alternative'),
    'bandcamp': ('Bandcamp Essentials', 'rock-indie-alternative'),
    # Electronic Dance
    'electronic-essentials': ('Essentials', 'electronic-dance'),
    'electro': ('Electro', 'electronic-dance-electro'),
    'house': ('House', 'electronic-dance-house'),
    'deep-house': ('Deep House', 'electronic-dance-house'),
    'electro-house': ('Electro House, French House', 'electronic-dance-house'),
    'progressive-house': ('Progressive House', 'electronic-dance-house'),
    'synthwave': ('Synthwave', 'electronic-dance-house'),
    'detroit-techno': ('Detroit Techno', 'electronic-dance-techno'),
    'minimal-techno': ('Minimal Techno, Microhouse', 'electronic-dance-techno'),
    'idm': ('IDM', 'electronic-dance-techno'),
    'breakbeat': ('Breakbeat', 'electronic-dance-breakbeat'),
    'big-beat': ('Big Beat', 'electronic-dance-breakbeat'),
    'nu-skool-breaks': ('Nu Skool Breaks', 'electronic-dance-breakbeat'),
    'trip-hop': ('Trip Hop', 'electronic-dance-breakbeat'),
    'downtempo': ('Downtempo, Acid Jazz', 'electronic-dance-breakbeat'),
    'trance': ('Trance', 'electronic-dance-trance'),
    'goa-trance': ('Goa Trance', 'electronic-dance-trance'),
    'psybient': ('Psybient', 'electronic-dance-trance'),
    'drum-and-bass': ('Drum and Bass', 'electronic-dance-drum-and-bass'),
    'jungle': ('Jungle', 'electronic-dance-drum-and-bass'),
    'neurofunk': ('Neurofunk', 'electronic-dance-drum-and-bass'),
    'breakbeat-hardcore': ('Breakbeat Hardcore', 'electronic-dance-drum-and-bass'),
    'breakcore': ('Breakcore', 'electronic-dance-drum-and-bass'),
    'uk-garage': ('UK Garage, Future Garage', 'electronic-dance-uk-garage-uk-bass'),
    'dubstep': ('Dubstep', 'electronic-dance-uk-garage-uk-bass'),
    'brostep': ('Brostep, Complextro', 'electronic-dance-uk-garage-uk-bass'),
    'deconstructed-club': ('Deconstructed Club', 'electronic-dance-uk-garage-uk-bass'),
    'glitch-hop': ('Glitch Hop', 'electronic-dance-glitch-hop-future-bass'),
    # Experimental
    'ambient': ('Ambient', 'experimental-experimental'),
    'dark-ambient': ('Dark Ambient', 'experimental-experimental'),
    'drone': ('Drone', 'experimental-experimental'),
    'noise': ('Noise, Power Electronics', 'experimental-experimental'),
    'industrial': ('Industrial', 'experimental-experimental'),
    'musique-concrete': ('Musique Concrète', 'experimental-experimental'),
    'progressive-electronic': ('Progressive Electronic', 'experimental-experimental'),
    'glitch': ('Glitch', 'experimental-experimental'),
    'chiptune': ('Chiptune', 'experimental-experimental'),
    'vaporwave': ('Vaporwave', 'experimental-experimental'),
    'future-funk': ('Future Funk', 'experimental-experimental'),
    'chillwave': ('Chillwave', 'experimental-experimental'),
    'hypnagogic-pop': ('Hypnagogic Pop', 'experimental-experimental'),
    'witch-house': ('Witch House', 'experimental-experimental'),
    'dungeon-synth': ('Dungeon Synth', 'experimental-experimental'),
    'oceangrunge': ('Oceangrunge', 'experimental-experimental'),
    'outsider-music': ('Outsider Music', 'experimental-experimental'),
    'sound-collage': ('Sound Collage, Mashup', 'experimental-experimental'),
    'field-recordings': ('Field Recordings', 'experimental-non-music'),
    'spoken-word': ('Spoken Word', 'experimental-non-music'),
    'comedy': ('Comedy', 'experimental-non-music'),
    # Hip Hop
    'hip-hop-essentials': ('Essentials', 'hip-hop'),
    'east-coast-hip-hop': ('East Coast Hip Hop', 'hip-hop-east-coast-related'),
    'west-coast-hip-hop': ('West Coast Hip Hop', 'hip-hop-west-coast-related'),
    'bay-area-hip-hop': ('Bay Area Hip Hop', 'hip-hop-west-coast-related'),
    'southern-hip-hop': ('Southern Hip Hop', 'hip-hop-southern-related'),
    'memphis-rap': ('Memphis Rap', 'hip-hop-southern-related'),
    'cloud-rap': ('Cloud Rap', 'hip-hop-southern-related'),
    'experimental-hip-hop': ('Experimental Hip Hop', 'hip-hop-alternative'),
    'underground-hip-hop': ('Underground Hip Hop', 'hip-hop-alternative'),
    'horrorcore': ('Horrorcore', 'hip-hop-alternative'),
    'instrumental-hip-hop': ('Instrumental Hip Hop', 'hip-hop-instrumental'),
    'turntablism': ('Turntablism', 'hip-hop-instrumental'),
    'uk-hip-hop': ('UK Hip Hop', 'hip-hop-international'),
    'spanish-rap': ('Spanish Rap', 'hip-hop-international'),
    # Jazz
    'jazz-essentials': ('Essentials', 'jazz'),
    'swing': ('Swing', 'jazz-big-band'),
    'big-band': ('Big Band', 'jazz-big-band'),
    'bebop-hard-bop': ('Bebop, Hard Bop, Modal', 'jazz-bebop-cool'),
    'free-jazz': ('Free Jazz', 'jazz-avant-garde'),
    'jazz-rock-fusion': ('Jazz Fusion', 'jazz-fusion'),
    'chamber-jazz': ('Chamber Jazz', 'jazz-fusion'),
    # Rhythm & Blues
    'soul': ('Soul', 'rhythm-and-blues-soul'),
    'funk': ('Funk', 'rhythm-and-blues-funk'),
    'italo-disco': ('Italo Disco', 'rhythm-and-blues-disco'),
    'reggae': ('Reggae, Dub', 'rhythm-and-blues-ska-reggae-reggaeton'),
    'ska': ('Ska', 'rhythm-and-blues-ska-reggae-reggaeton'),
    'reggaeton': ('Reggaeton, Neoperreo', 'rhythm-and-blues-ska-reggae-reggaeton'),
    # North American
    'blues': ('Blues', 'north-american-blues'),
    'country': ('Country, Americana', 'north-american-country'),
    'folk': ('Folk', 'north-american-contemporary-folk'),
    'freak-folk': ('Freak Folk, Psych Folk', 'north-american-contemporary-folk'),
    'vocal-jazz': ('Vocal Jazz', 'north-american-other'),
    # Latin American, East Asian, Central Asian, African
    'bossa-nova': ('Bossa Nova, Samba-Jazz', 'latin-american-brazilian'),
    'tropicalia': ('Tropicália, Vanguarda Paulista', 'latin-american-brazilian'),
    'latin-jazz': ('Mambo, Salsa', 'latin-american-caribbean'),
    'city-pop': ('City Pop', 'east-asian-japanese'),
    'k-pop': ('K-Pop', 'east-asian-korean-vietnamese'),
    'tuvan-throat-singing': ('Tuvan Throat Singing', 'central-asian'),
    'afrobeat': ('Afrobeat', 'sub-saharan-african-western'),
    # Western Classical
    'classical-essentials': ('Essentials', 'western-classical'),
    'ancient-music': ('Ancient Music', 'ancient'),
    'medieval': ('Medieval', 'western-classical-medieval'),
    'renaissance': ('Renaissance', 'western-classical-renaissance'),
    'baroque': ('Baroque', 'western-classical-baroque'),
    'classical-period': ('Classical Period', 'western-classical-classical'),
    'romantic': ('Romantic', 'western-classical-romantic'),
    'modern-classical': ('Modern Classical', 'western-classical-modern'),
    'contemporary-classical': ('Contemporary Classical', 'western-classical-postmodern'),
    'minimalism': ('Minimalism', 'western-classical-postmodern'),
    'musicals': ('Musicals', 'western-classical-other'),
}
ESSENTIAL = {'electronic-essentials', 'hip-hop-essentials', 'jazz-essentials', 'classical-essentials', 'bandcamp'}

# Field recordings of the Traditional/Regional chart, by the family of their country. They are
# filed one level up, on the family's pillar: a "Field Recordings" genre per pillar
# (<pillar>-field-recordings), rather than thirty families holding one or two each.
REGION = {
    'sub-saharan-african-southern': 'Angola, Botswana, Lesotho, Malawi, Mozambique, Namibia, Swaziland, Zambia, Zimbabwe',
    'sub-saharan-african-central': 'Burundi, Cameroon, Central African Republic, Chad, Congo, Gabon, Rwanda',
    'sub-saharan-african-western': 'Benin, Burkina Faso, Cape Verde, Gambia, Ghana, Guinea, Ivory Coast, Liberia, Mali, Niger, Nigeria, Senegal, Sierra Leone, Togo',
    'sub-saharan-african-eastern': 'Kenya, Somalia, South Sudan, Tanzania, Uganda',
    'sub-saharan-african-indian-ocean': 'Comoros, Madagascar, Mauritius, Seychelles',
    'greater-middle-eastern-northeast-african': 'Eritrea, Ethiopia, Sudan',
    'greater-middle-eastern-north-african': 'Algeria, Egypt, Libya, Mauritania, Morocco, Tunisia',
    'greater-middle-eastern-arabic': 'Bahrain, Iraq, Lebanon, Oman, Palestine, Qatar, Saudi Arabia, Syria, Yemen',
    'greater-middle-eastern-iranian': 'Afghanistan, Iran',
    'greater-middle-eastern-turkic-oghuz': 'Azerbaijan, Turkey, Turkmenistan',
    'greater-middle-eastern-jewish': 'Israel',
    'greater-middle-eastern-caucasian': 'Armenia, Georgia',
    'south-asian-folk': 'Bangladesh, India, Nepal, Pakistan, Sri Lanka',
    'central-asian': 'Kazakhstan, Kyrgyzstan, Mongolia, Tajikistan, Uzbekistan',
    'east-asian-chinese': 'China, Taiwan',
    'east-asian-japanese': 'Japan',
    'east-asian-korean-vietnamese': 'North Korea, South Korea, Vietnam',
    'east-asian-tibetan-bhutanese': 'Bhutan',
    'southeast-asian-and-oceanian-indochinese': 'Cambodia, Laos, Myanmar, Thailand',
    'southeast-asian-and-oceanian-austronesian': 'Brunei, Indonesia, Malaysia, Philippines, Federated States of Micronesia, Fiji, Kiribati, New Zealand, Samoa, Solomon Islands, Tuvalu, Vanuatu',
    'southeast-asian-and-oceanian-other': 'Australia',
    'european-eastern': 'Albania, Belarus, Bosnia and Herzegovina, Bulgaria, Croatia, Czech Republic, Estonia, Finland, Greece, Hungary, Kosovo, Latvia, Lithuania, Macedonia, Moldova, Montenegro, Poland, Romania, Serbia, Slovakia, Slovenia, Ukraine',
    'european-western': 'Austria, Belgium, Denmark, France, Germany, Ireland, Italy, Malta, Netherlands, Norway, Portugal, Spain, Sweden, Switzerland, United Kingdom',
    'latin-american-mexican': 'Mexico',
    'latin-american-caribbean': 'Cuba, Dominican Republic',
    'latin-american-greater-colombian': 'Colombia, Costa Rica, El Salvador, Guatemala, Honduras, Nicaragua',
    'latin-american-greater-andean': 'Argentina, Peru',
    'latin-american-greater-pampean': 'Paraguay, Uruguay',
    'latin-american-brazilian': 'Brazil',
    'indigenous-american': 'Guyana, Surinam',
    'north-american-other': 'Canada, USA',
    'caribbean-english': 'Antigua and Barbuda, Bahamas, Barbados, Belize, Dominica, Grenada, Jamaica, St. Kitts and Nevis, St. Lucia, St. Vincent and the Grenadines',
    'caribbean-french': 'Haiti',
}
PILLAR_OF: dict[str, str] = {}  # family -> its pillar, filled in from mucore.yaml
COUNTRY = {c.strip(): family for family, names in REGION.items() for c in names.split(',')}

# Classical (General), Classical 2 and 3 name composers: each credit's era, by its first composer.
ERA = {
    'medieval': ['Hildegard von Bingen', 'Léonin', 'Pérotin', 'Perotin', 'Petrus de Cruce &c.'],
    'renaissance': ['Busnoys &c.', 'Clemens non Papa', 'Gesualdo', 'Isaac', 'Josquin', 'Lassus', 'Obrecht', 'Ockeghem'],
    'baroque': ['Bach', 'Händel', 'Handel', 'Schütz', 'Vivaldi'],
    'classical-period': ['Haydn', 'J. C. Bach', 'M. Haydn', 'Mozart', 'Vanhal', 'Beethoven & Mozart'],
    'romantic': ['Beethoven', 'Berlioz', 'Brahms', 'Bruckner', 'Chopin', 'Dvořák', 'Grieg', 'Liszt', 'Mahler', 'Mussorgsky',
                 'Rachmaninov', 'Rachmaninoff & Tchaikovsky', 'Reger', 'R. Strauss', 'Rossini', 'Schubert', 'Schubert & Schumann',
                 'Schumann', 'Scriabin', 'Tchaikovsky', 'Verdi', 'Wagner', 'Zemlinsky', 'Brahms, Tchaikovsky & Bach',
                 'Dvořák, Smetana & Liszt'],
    'modern-classical': ['Bartók', 'Debussy', 'Hindemith', 'Ives', 'Janáček', 'Nielsen', 'Petrassi', 'Prokofiev', 'Prokofiev & Ravel',
                         'Ravel', 'Satie', 'Schönberg, Berg & Webern', 'Schoenberg / Webern / Berg', 'Shostakovich', 'Stravinsky',
                         'Stravinsky & Scriabin'],
    'contemporary-classical': ['Boulez, Prokofiev, Stravinsky & Webern', 'Carter', 'Davies', 'Górecki', 'Ligeti', 'Messiaen',
                               'Penderecki', 'Pärt', 'Stockhausen', 'Glenn Branca', 'Rhys Chatham', 'Meredith Monk'],
    'minimalism': ['Glass', 'Reich', 'Terry Riley'],
}
COMPOSER = {name: era for era, names in ERA.items() for name in names}

# Each chart's genre: a genre id, or a list of (section prefix, genre id) read in order, the last
# with prefix '' for any other section.
S = list
CHART = {
    '50s-rock-and-roll': 'rock-and-roll', '60s-jazz': 'jazz-essentials', '60s-psychedelia': 'psychedelic-rock',
    '70s-punk': 'punk-rock', '70s-80s-post-punk': 'post-punk', '70s-80s-punk-hardcore': 'hardcore-punk',
    '80s-punk-hardcore': 'hardcore-punk', '90s-alternative-grunge': 'alternative-rock', '90s-electronic': 'electronic-essentials',
    '90s-punk-pop-punk': 'pop-punk', '00s-ambient': 'ambient',
    '00s-punk': S([('Ska Punk', 'ska'), ('Folk Punk', 'folk-punk'), ('Crust', 'crust-powerviolence'), ('', 'punk-rock')]),
    '10s-hip-hop': 'hip-hop-essentials', '10s-hip-hop-2': 'hip-hop-essentials', 'acid-funk-jazz': 'downtempo',
    'afrobeat': 'afrobeat', 'aggrotech': 'ebm-electro-industrial', 'alternative-rock': 'alternative-rock',
    'ambient-1': 'ambient', 'ambient-2': S([('Dark Ambient', 'dark-ambient'), ('', 'ambient')]), 'ambient-3': 'ambient',
    'ambient-4': S([('Darker', 'dark-ambient'), ('Darkest', 'dark-ambient'), ('', 'ambient')]),
    'americana': 'country', 'arctic-ambient': 'ambient', 'art-pop': 'art-pop', 'art-pop-2': 'art-pop',
    'art-punk': 'art-punk', 'art-rap': 'experimental-hip-hop', 'audio-core': 'sound-collage',
    'avant-garde-metal': 'avant-garde-metal', 'bandcamp-essentials': 'bandcamp', 'bay-area-hip-hop': 'bay-area-hip-hop',
    'bedroom-pop-lo-fi-indie-pop': S([('instrumental hip hop', 'instrumental-hip-hop'), ('sadder', 'slowcore'), ('heavier', 'shoegaze'), ('', 'indie-pop')]),
    'bigbeat': 'big-beat', 'blackgaze-by-mood': 'blackgaze',
    'black-metal': 'black-metal', 'black-metal-2': 'black-metal', 'black-metal-3': 'black-metal',
    'black-metal-4': S([('Depressive', 'depressive-black-metal'), ('Blackgaze', 'blackgaze'), ('Dungeon Synth', 'dungeon-synth'), ('Black Ambient', 'dark-ambient'), ('Blackened Noise', 'noise'), ('', 'black-metal')]),
    'black-metal-5': S([('Depressive', 'depressive-black-metal'), ('Blackgaze', 'blackgaze'), ('Dungeon Synth', 'dungeon-synth'), ('Black Ambient', 'dark-ambient'), ('Black Noise', 'noise'), ('Black/Death', 'death-metal'), ('', 'black-metal')]),
    'black-metal-by-country': 'black-metal', 'black-metal-atmospheric': 'black-metal', 'blues': 'blues',
    'bossa-nova': 'bossa-nova', 'bossa-nova-2': 'bossa-nova', 'breakbeat-by-genre': 'breakbeat',
    'breakbeat-hardcore': 'breakbeat-hardcore', 'breakcore': 'breakcore', 'britpop': 'britpop', 'britpop-2': 'britpop',
    'britpop-3': 'britpop', 'brostep': 'brostep', 'brostep-complextro': 'brostep', 'canterbury-scene': 'canterbury-scene',
    'caverncore': 'death-metal', 'chamber-jazz': 'chamber-jazz', 'chillwave-1': 'chillwave', 'chillwave-2': 'chillwave',
    'chiptune': 'chiptune', 'city-pop': 'city-pop', 'classical-general': 'classical-essentials', 'classical-2': 'classical-essentials',
    'classical-3': 'classical-essentials', 'classical-ancient': 'ancient-music', 'classical-renaissance': 'renaissance',
    'classical-renaissance-2': 'renaissance', 'classical-baroque': 'baroque', 'classical-period': 'classical-period',
    'classical-contemporary': 'contemporary-classical', 'classical-musique-concrete': 'musique-concrete',
    'classical-minimalism': 'minimalism', 'cloud-rap': 'cloud-rap', 'comedy-music': 'comedy', 'country': 'country',
    'dance-punk': 'dance-punk', 'dark-ambient-obscure': 'dark-ambient', 'dark-ambient-general': 'dark-ambient',
    'deathcore': 'metalcore', 'death-metal-by-subgenre': S([('Melodic Death', 'melodic-death-metal'), ('Deathgrind', 'grindcore'), ('Death/Doom', 'doom-metal'), ('', 'death-metal')]),
    'deconstructed-club': 'deconstructed-club', 'deep-house': 'deep-house', 'depressive-black-metal-dsbm': 'depressive-black-metal',
    'depressive-suicidal-black-metal': 'depressive-black-metal', 'desert-rock': 'stoner-rock', 'desert-rock-2': 'stoner-rock',
    'detroit-techno': 'detroit-techno', 'djent': 'progressive-metal',
    'doom-metal-by-subgenre': S([('Stoner', 'stoner-rock'), ('Drone', 'drone-metal'), ('Sludge', 'sludge-metal'), ('Atmospheric Sludge', 'sludge-metal'), ('', 'doom-metal')]),
    'doom-metal-2': S([('Stoner', 'stoner-rock'), ('Sludge', 'sludge-metal'), ('Atmospheric', 'sludge-metal'), ('Drone', 'drone-metal'), ('', 'doom-metal')]),
    'doom-punk': 'hardcore-punk', 'downtempo-chillout-trip-hop-broken-beat-lounge-acid-jazz-nu-jazz': 'downtempo',
    'dream-pop': 'dream-pop', 'drone': 'drone', 'drone-metal': 'drone-metal', 'drone-rock-metal': 'drone-metal',
    'drum-n-bass': 'drum-and-bass', 'drum-n-bass-2': 'drum-and-bass', 'dubstep-1': 'dubstep', 'dubstep-2': 'dubstep',
    'dungeon-synth': 'dungeon-synth', 'dungeon-synth-2014': 'dungeon-synth', 'dungeon-synth-complete-chart': 'dungeon-synth',
    'dungeon-synth-complete-2': 'dungeon-synth', 'east-coast-hip-hop': 'east-coast-hip-hop', 'electro': 'electro',
    'electro-house': 'electro-house', 'electronic-by-genre': 'electronic-essentials', 'electronic-general': 'electronic-essentials',
    'emo': 'emo', 'emo-2': 'emo', 'emo-3': 'emo', 'emo-4': 'emo', 'emo-5': 'emo', 'emo-revival': 'emo', 'emo-5th-wave': 'emo',
    'experimental-hip-hop-1': 'experimental-hip-hop', 'experimental-hip-hop-2': 'experimental-hip-hop',
    'experimental-hip-hop-volume-iii': 'experimental-hip-hop', 'experimental-shoegaze-dream-pop': 'shoegaze',
    'field-recordings': 'field-recordings', 'field-recordings-2': 'field-recordings', 'folk': 'folk', 'folk-with-female-vocals': 'folk',
    'folk-metal': 'folk-metal', 'folk-viking-metal': 'folk-metal', 'folk-punk': 'folk-punk', 'freak-folk-1': 'freak-folk',
    'freak-folk-2': 'freak-folk', 'free-jazz-essentials': 'free-jazz', 'french-electro-house': 'electro-house', 'funk': 'funk',
    'future-funk': 'future-funk', 'future-funk-2': 'future-funk', 'future-funk-3': 'future-funk',
    'garage': S([('US garage', 'house'), ('', 'uk-garage')]), 'garage-2': 'uk-garage', 'glitch': 'glitch', 'glitch-2': 'glitch',
    'glitch-hop': 'glitch-hop', 'goa-trance': 'goa-trance', 'goth': 'gothic-rock', 'grindcore': 'grindcore', 'grunge': 'grunge',
    'grunge-2': 'grunge', 'hard-blues-rock': 'hard-rock', 'hard-rock-ii': 'hard-rock', 'harsh-noise': 'noise',
    'hip-hop-1': 'hip-hop-essentials', 'hip-hop-2': 'hip-hop-essentials', 'hip-hop-3': 'hip-hop-essentials',
    'hip-hop-concept-albums': 'hip-hop-essentials', 'hipster-black-metal': S([('Post-Black', 'blackgaze'), ('', 'black-metal')]),
    'horrorcore': 'horrorcore', 'house': 'house', 'hypnagogic-pop': 'hypnagogic-pop', 'idm': 'idm', 'idm-2': 'idm',
    'indie-pop': 'indie-pop', 'indietronica': 'indietronica', 'industrial': 'industrial',
    'industrial-2': S([('Dark Ambient', 'dark-ambient'), ('Neofolk', 'neofolk'), ('EBM', 'ebm-electro-industrial'), ('Industrial Rock/Metal', 'industrial-metal'), ('Noise', 'noise'), ('', 'industrial')]),
    'industrial-3': 'industrial',
    'industrial-4': S([('Electro-Industrial', 'ebm-electro-industrial'), ('Dark Electro', 'ebm-electro-industrial'), ('Aggrotech', 'ebm-electro-industrial'), ('EBM', 'ebm-electro-industrial'), ('Futurepop', 'ebm-electro-industrial'), ('New Beat', 'ebm-electro-industrial'), ('Industrial Rock', 'industrial-metal'), ('Industrial Metal', 'industrial-metal'), ('Cyber Metal', 'industrial-metal'), ('Neue Deutsche', 'industrial-metal'), ('Industrial Hip Hop', 'experimental-hip-hop'), ('Industrial Techno', 'industrial'), ('Dark Ambient', 'dark-ambient'), ('Neofolk', 'neofolk'), ('Neoclassical', 'neofolk'), ('', 'industrial')]),
    'industrial-grunge': 'grunge', 'industrial-metal': S([('Industrial Black', 'black-metal'), ('', 'industrial-metal')]),
    'instrumental-metal': S([('Doom', 'doom-metal'), ('Drone', 'drone-metal'), ('Atmosludge', 'sludge-metal'), ('Black', 'black-metal'), ('Jazz Fusion', 'progressive-metal'), ('Misc, power', 'power-metal'), ('Misc, tech death', 'death-metal'), ('Misc, symphonic', 'symphonic-gothic-metal'), ('', 'progressive-metal')]),
    'instrumental-hip-hop': 'instrumental-hip-hop', 'instrumental-hip-hop-2': S([('Turntablism', 'turntablism'), ('', 'instrumental-hip-hop')]),
    'italo-disco': 'italo-disco', 'jangle-pop': 'jangle-pop', 'jangle-pop-2': 'jangle-pop', 'jazz': 'jazz-essentials',
    'jazz-2': S([('Traditional', 'swing'), ('Swing', 'swing'), ('Bebop', 'bebop-hard-bop'), ('Cool', 'bebop-hard-bop'), ('Hard Bop', 'bebop-hard-bop'), ('Late 50s', 'bebop-hard-bop'), ('Modal', 'bebop-hard-bop'), ('Avant-Garde', 'free-jazz'), ('Free Jazz', 'free-jazz'), ('Fusion', 'jazz-rock-fusion'), ('', 'jazz-essentials')]),
    'jazz-3-further-explorations': S([('Piano Trios', 'bebop-hard-bop'), ('Big Band', 'big-band'), ('Vocal Jazz', 'vocal-jazz'), ('Bossa Nova', 'bossa-nova'), ('Jazz Guitar', 'bebop-hard-bop'), ('Mambo', 'latin-jazz'), ('Monk', 'bebop-hard-bop'), ('', 'jazz-essentials')]),
    'jazz-1959-1979': 'jazz-essentials', 'jungle': 'jungle', 'k-pop': 'k-pop', 'kosmische': 'krautrock', 'krautrock': 'krautrock',
    'krautrock-2': 'krautrock', 'krautrock-3': 'krautrock', 'lolicore': 'breakcore', 'mashup': 'sound-collage',
    'math-rock-1': 'math-rock', 'math-rock-2': 'math-rock', 'math-rock-3': 'math-rock', 'mathcore-metalcore': 'metalcore',
    'medieval': 'medieval', 'melodic-death-metal': 'melodic-death-metal', 'memphis-rap': 'memphis-rap',
    'metal-by-genre': S([('heavy', 'heavy-metal'), ('thrash', 'thrash-metal'), ('power', 'power-metal'), ('black', 'black-metal'), ('death', 'death-metal'), ('doom', 'doom-metal'), ('folk', 'folk-metal'), ('progressive', 'progressive-metal'), ('melodic death', 'melodic-death-metal'), ('grindcore', 'grindcore'), ('', 'heavy-metal')]),
    'metal-subgenres': S([('Traditional Doom', 'doom-metal'), ('Death Metal', 'death-metal'), ('Funeral Doom', 'doom-metal'), ('Black Metal', 'black-metal'), ('Gothic Doom', 'doom-metal'), ('Grindcore', 'grindcore'), ('Melodic Death', 'melodic-death-metal'), ('Thrash', 'thrash-metal'), ('Stoner', 'stoner-rock'), ('Sludge', 'sludge-metal'), ('', 'heavy-metal')]),
    'metal-subgenres-2': S([('Heavy Psych', 'stoner-rock'), ('Hard Rock', 'hard-rock'), ('Glam', 'heavy-metal'), ('Trad Doom', 'doom-metal'), ('Epic Doom', 'doom-metal'), ('Heavy Metal', 'heavy-metal'), ('NWOBHM', 'heavy-metal'), ('USPM', 'power-metal'), ('Speed', 'heavy-metal'), ('Power', 'power-metal'), ('Prog Metal', 'progressive-metal'), ('Neoclassical', 'power-metal'), ('Symphonic Metal', 'symphonic-gothic-metal'), ('Gothic', 'symphonic-gothic-metal'), ('Folk', 'folk-metal'), ('Thrash', 'thrash-metal'), ('Tech Thrash', 'thrash-metal'), ('Crossover', 'thrash-metal'), ('Death Thrash', 'thrash-metal'), ('First Wave Black', 'black-metal'), ('Death Metal', 'death-metal'), ('Tech Death', 'death-metal'), ('Brutal Death', 'death-metal'), ('Slam', 'death-metal'), ('Death Grind', 'grindcore'), ('Black Metal', 'black-metal'), ('Atmospheric Black', 'black-metal'), ('Melodic Black', 'black-metal'), ('Symphonic Black', 'black-metal'), ('DSBM', 'depressive-black-metal'), ('Black Death', 'black-metal'), ('War Metal', 'black-metal'), ('Grindcore', 'grindcore'), ('Avant', 'avant-garde-metal'), ('Industrial', 'industrial-metal'), ('Viking', 'folk-metal'), ('Deathdoom', 'doom-metal'), ('Funeral', 'doom-metal'), ('Drone', 'drone-metal'), ('Doomsludge', 'sludge-metal'), ('Metalcore', 'metalcore'), ('Atmo Sludge', 'sludge-metal'), ('Stoner', 'stoner-rock'), ('Melodeath', 'melodic-death-metal'), ('Progressive Death', 'progressive-metal'), ('Groove', 'thrash-metal'), ('Alt Metal', 'nu-metal'), ('Nu Metal', 'nu-metal'), ('Melodic Metalcore', 'metalcore'), ('Deathcore', 'metalcore'), ('', 'heavy-metal')]),
    'metal-subgenres-3': S([('Heavy Metal', 'heavy-metal'), ('Power', 'power-metal'), ('Thrash', 'thrash-metal'), ('Death Metal', 'death-metal'), ('Brutal Death', 'death-metal'), ('Grind', 'grindcore'), ('Death Doom', 'doom-metal'), ('Sludge', 'sludge-metal'), ('Black', 'black-metal'), ('Folk', 'folk-metal'), ('', 'heavy-metal')]),
    'metalcore-post-hardcore': S([('Modern post-hardcore', 'post-hardcore'), ('', 'metalcore')]),
    'minimal-techno-microhouse': 'minimal-techno', 'modern-baroque-pop': 'baroque-pop', 'modern-funk': 'funk',
    'modern-post-punk': 'post-punk', 'modern-prog': 'progressive-rock',
    'modern-prog-2': S([('Traditional + Power prog metal', 'progressive-metal'), ('Other prog metal', 'progressive-metal'), ('Prog metalcore', 'progressive-metal'), ('Math Rock', 'post-rock'), ('Avant-prog', 'avant-prog'), ('', 'progressive-rock')]),
    'modern-psychedelic': 'psychedelic-rock', 'mu-sicals': 'musicals', 'neofolk': 'neofolk', 'neo-prog': 'progressive-rock',
    'neo-psychedelia': 'neo-psychedelia', 'neurofunk': 'neurofunk', 'new-wave': 'new-wave',
    'new-wave-of-traditional-metal': 'heavy-metal', 'no-wave': 'no-wave', 'noise': 'noise', 'noise-hip-hop': 'experimental-hip-hop',
    'noise-pop': 'noise-pop', 'noise-rock': 'noise-rock', 'noise-rock-essentials-2': 'noise-rock',
    'noise-rock-now-wave-japanese-noise-rock': 'noise-rock', 'nu-metal': 'nu-metal', 'nu-skool-funky-breaks': 'nu-skool-breaks',
    'oceangrunge': 'oceangrunge', 'old-school-death-metal': 'death-metal', 'outsider-music': 'outsider-music',
    'polish-new-wave': S([('bonus, Polish synthpop', 'synth-pop'), ('', 'new-wave')]), 'pop-punk': 'pop-punk', 'pop-punk-by-decade': 'pop-punk',
    'post-hardcore-1': 'post-hardcore', 'post-hardcore-2': 'post-hardcore', 'post-hardcore-3': 'post-hardcore',
    'post-punk-1': 'post-punk', 'post-punk-2': 'post-punk',
    'post-punk-by-subgenre': S([('New Wave', 'new-wave'), ('No Wave', 'no-wave'), ('Goth', 'gothic-rock'), ('', 'post-punk')]),
    'post-punk-and-new-wave': 'post-punk', 'post-rock': 'post-rock', 'post-rock-2': 'post-rock', 'post-rock-post-metal-history': 'post-rock',
    'powerelectronics': 'noise', 'power-metal-1': 'power-metal', 'power-metal-2': 'power-metal', 'power-metal-3': 'power-metal',
    'power-pop': 'power-pop', 'powerviolence-grindcore-crust-crossover-thrash': S([('grindcore', 'grindcore'), ('crossover', 'hardcore-punk'), ('', 'crust-powerviolence')]),
    'progressive-electronic': 'progressive-electronic', 'progressive-house': 'progressive-house', 'progressive-metal': 'progressive-metal',
    'progressive-metal-introduction': 'progressive-metal', 'progressive-rock-1': 'progressive-rock', 'progressive-rock-2': 'progressive-rock',
    'progressive-rock-3': 'progressive-rock', 'progressive-rock-4': 'progressive-rock',
    'progressive-rock-5': S([('Psychedelic Rock', 'psychedelic-rock'), ('Acid', 'psychedelic-rock'), ('Raga', 'psychedelic-rock'), ('Space', 'psychedelic-rock'), ('Krautrock', 'krautrock'), ('Progressive Electronic', 'progressive-electronic'), ('Hard Rock', 'hard-rock'), ('Heavy Metal', 'heavy-metal'), ('Glam', 'hard-rock'), ('AOR', 'hard-rock'), ('Canterbury', 'canterbury-scene'), ('Avant-Prog', 'avant-prog'), ('Zeuhl', 'zeuhl'), ('Brutal Prog', 'avant-prog'), ('Baroque Pop', 'baroque-pop'), ('Progressive Folk', 'freak-folk'), ('Progressive Metal', 'progressive-metal'), ('Djent', 'progressive-metal'), ('Jazz Fusion', 'jazz-rock-fusion'), ('Math Rock', 'math-rock'), ('Post-Rock', 'post-rock'), ('', 'progressive-rock')]),
    'proto-punk': 'punk-rock', 'psybient-psychill': 'psybient', 'psychedelic-drone': 'drone',
    'psychedelic-rock-pop-1966-1972': 'psychedelic-rock', 'psychedelic-rock-2': 'psychedelic-rock', 'psychobilly': 'psychobilly',
    'punk-hardcore-new-york': 'hardcore-punk', 'punk-2': 'punk-rock', 'raga-rock': 'psychedelic-rock', 'rave': 'electronic-essentials',
    'reggae': 'reggae', 'reggae-2': S([('Jamaican Ska', 'ska'), ('Rocksteady', 'ska'), ('', 'reggae')]), 'reggae-dub-ska': 'reggae',
    'reggaeton-and-neoperreo': 'reggaeton', 'samba-jazz': 'bossa-nova', 'sampling': 'instrumental-hip-hop', 'scratch': 'turntablism',
    'shoegaze': 'shoegaze', 'shoegaze-by-genre': 'shoegaze', 'shoegaze-dream-pop': 'shoegaze', 'ska': 'ska',
    'skacore-crack-rocksteady': 'ska', 'slowcore': 'slowcore', 'slowcore-and-sadcore': 'slowcore',
    'sludge-metal-atmospheric-post-metal': 'sludge-metal', 'soft-rock-yacht-rock': 'soft-rock', 'soul': 'soul',
    'southern-hip-hop': 'southern-hip-hop', 'southern-hip-hop-2': 'southern-hip-hop', 'southern-rock': 'southern-rock',
    'space-black-metal': 'black-metal', 'space-metal': 'space-metal', 'spanish-punk-hardcore': 'hardcore-punk',
    'spanish-rap': 'spanish-rap', 'spoken-word': 'spoken-word', 'stoner-rock': 'stoner-rock',
    'stoner-metal-stoner-rock-desert-rock': 'stoner-rock', 'surf': 'surf', 'synth-pop': 'synth-pop', 'synthwave': 'synthwave',
    'synthwave-2': 'synthwave', 'swedish-death-metal': 'death-metal', 'swing': 'swing', 'thrash-metal': 'thrash-metal',
    'thrash-black-metal': 'thrash-metal', 'traditional-metal': 'heavy-metal', 'trance': 'trance', 'tribal': 'neo-psychedelia',
    'trip-hop': 'trip-hop', 'tropicalia': 'tropicalia', 'tuvan-throat-singing': 'tuvan-throat-singing', 'twee-pop': 'twee-pop',
    'underground-hip-hop-2010-2019': S([('Instrumentals', 'instrumental-hip-hop'), ('', 'underground-hip-hop')]),
    'uk-hip-hop': 'uk-hip-hop', 'vanguarda-paulista': 'tropicalia',
    'vaporwave-1': 'vaporwave', 'vaporwave-2': 'vaporwave',
    'vaporwave-3': S([('Future funk', 'future-funk'), ('Vaportrap', 'vaporwave'), ('', 'vaporwave')]),
    'vaporwave-4': S([('Future funk', 'future-funk'), ('', 'vaporwave')]),
    'vaporwave-5': S([('Future funk', 'future-funk'), ('Synthwave', 'synthwave'), ('', 'vaporwave')]),
    'vaporwave-6': 'vaporwave', 'warm-drone': 'drone', 'west-coast-hip-hop': 'west-coast-hip-hop', 'witch-house': 'witch-house',
    'witch-house-2': 'witch-house', 'wyrd-folk': 'freak-folk', 'zeuhl': 'zeuhl', 'zeuhl-2': 'zeuhl',
    'traditional-regional-music': 'by-country',
    # Portraits only, and a copy of Kosmische: no albums.
    'classical-composers-exit-level': 'none', 'classical-composers-not-entry-level': 'none',
}


def section_of(note: str) -> str:
    m = re.search(r'section: ([^;]+)', note or '')
    return m[1].strip() if m else ''


def row_genre(chart: str, note: str, artist: str) -> str:
    rule = CHART[chart]
    if rule == 'by-country':
        country = (note or '').split(';')[0].split(' (')[0].strip()
        family = next((COUNTRY[c.strip()] for c in country.split(',') if c.strip() in COUNTRY), '')
        return f'{PILLAR_OF[family]}-field-recordings' if family else 'field-recordings'
    if rule == 'classical-essentials':
        return COMPOSER.get(artist.strip(), 'classical-essentials')
    if isinstance(rule, list):
        section = section_of(note)
        return next(g for prefix, g in rule if section.startswith(prefix))
    return rule


def ascii_slug(text: str) -> str:
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def yaml_string(text: str) -> str:
    return json.dumps(text, ensure_ascii=False)


def mucore_parts() -> tuple[str, str]:
    """mucore.yaml as /mu/core has it, without what an earlier run added: (tracks, tree)."""
    with open(MUCORE, encoding='utf-8') as f:
        head, tree = f.read().split('\ntree:\n', 1)
    return head.split(f'\n{MARK}\n')[0], tree.split(f'\n    {MARK}\n')[0]


def mucore_nodes() -> dict[str, dict]:
    """The tree's nodes as /mu/core has them: id -> {name, icon, sector}. Not those an earlier run added."""
    nodes = {}
    for line in mucore_parts()[1].split('\n'):
        m = re.match(r'\s+- \{ id: ([\w-]+), name: "([^"]*)"(?:, kind: \w+)?, icon: ([\w-]+)(?:, sector: ([\w-]+))?', line)
        if m:
            nodes[m[1]] = {'name': m[2], 'icon': m[3], 'sector': m[4] or ''}
    return nodes


def region_name(nodes: dict, node: str) -> str:
    """"Sub-Saharan African", or "Sub-Saharan African, Southern": a node's name, after its pillar's."""
    pillar = nodes[node]['sector']
    return nodes[node]['name'] if pillar == node else f'{nodes[pillar]["name"]}, {nodes[node]["name"]}'


def main() -> None:
    nodes = mucore_nodes()
    genres = dict(G)
    for family in REGION:
        PILLAR_OF[family] = nodes[family]['sector']
        genres[f'{nodes[family]["sector"]}-field-recordings'] = ('Field Recordings', nodes[family]['sector'])
    for family, (_, pillar) in FAMILIES.items():
        assert pillar in nodes, pillar
    entries = set(re.findall(r'^      - id: (\S+)', mucore_parts()[0], re.M))
    for gid, (_, parent) in genres.items():
        assert parent in nodes or parent in FAMILIES, f'{gid}: no node {parent}'
        # A genre is a node and an entry: neither id may be one /mu/core already has.
        assert gid not in nodes and gid not in entries, f'{gid}: /mu/core already has this id'

    albums = [a for a in json.load(open(ESSENTIALS, encoding='utf-8')) if not a['mucore']]
    artist_only = sorted({a['artist'] for a in albums if a['artist'] and not a['album']})
    albums = [a for a in albums if a['album']]
    rows_genre = []
    for a in albums:
        named = []
        for r in a['charts']:
            g = row_genre(r['chart'], r.get('note', ''), a['artist'])
            if g != 'none':
                named.append(g)
        rows_genre.append(named)
    size = collections.Counter(g for named in rows_genre for g in set(named))

    placed = collections.defaultdict(list)
    for a, named in zip(albums, rows_genre):
        if not named:
            continue
        weight = collections.Counter()
        for g in named:
            weight[g] += 0.5 if g in ESSENTIAL else 1
        genre = min(weight, key=lambda g: (-weight[g], size[g], g))
        placed[genre].append(a)

    # genres.md: the tree below each pillar, with the number of albums in each genre.
    by_parent = collections.defaultdict(list)
    for gid, (name, parent) in genres.items():
        if placed.get(gid):
            by_parent[parent].append((name, gid))
    lines = ['# /mu/ Essential Charts genres', '', 'Written by organise.py. Each genre is a new node under a /mu/core family (or a',
             'new family, marked "new"), and a syllabus entry holding the albums filed under it.', '']
    total = 0
    pillars = [n for n, v in nodes.items() if v['sector'] == n] + ['central-asian', 'ancient']
    for pillar in dict.fromkeys(pillars):
        families = [f for f, v in nodes.items() if v['sector'] == nodes[pillar]['sector'] and f != pillar] + [f for f, (_, p) in FAMILIES.items() if p == pillar]
        block = []
        own = by_parent.get(pillar, [])
        for name, gid in sorted(own):
            block.append(f'- {name}: {len(placed[gid])}')
        for family in families:
            if family not in by_parent:
                continue
            label = FAMILIES[family][0] + ' (new)' if family in FAMILIES else nodes[family]['name']
            block.append(f'- {label}')
            for name, gid in sorted(by_parent[family]):
                block.append(f'  - {name}: {len(placed[gid])}')
        if block:
            lines += [f'## {nodes[pillar]["name"]}', ''] + block + ['']
    total = sum(len(v) for v in placed.values())
    lines += [f'{len(placed)} genres, {total} albums.', '']
    if artist_only:
        lines += ['## Not filed', '', 'These charts name only an artist, not which album:', '']
        lines += [f'- {name}' for name in artist_only] + ['']
    with open(GENRES_MD, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print('\n'.join(lines))

    if '--write' in sys.argv:
        write_yaml(nodes, genres, placed)


def write_yaml(nodes: dict, genres: dict, placed: dict) -> None:
    order = [gid for gid in genres if placed.get(gid)]

    entries = []
    for gid in order:
        name, parent = genres[gid]
        # "Field Recordings" is a genre of many families: its entry says whose.
        title = name if name != 'Field Recordings' else f'Field Recordings: {region_name(nodes, parent)}'
        entries.append(f'      - id: {gid}\n        title: {yaml_string(title)}\n        kind: study\n        medium: album\n        tags: [{gid}]\n        childRule: all\n        children:')
        seen = set()
        for a in sorted(placed[gid], key=lambda a: (ascii_slug(a['artist']), ascii_slug(a['album']))):
            base = ascii_slug(f'{a["artist"]} {a["album"]}')[:80].strip('-') or 'album-' + hashlib.md5(f'{a["artist"]}\t{a["album"]}'.encode()).hexdigest()[:8]
            wid, n = base, 2
            while wid in seen:
                wid, n = f'{base}-{n}', n + 1
            seen.add(wid)
            genre_name = name if name != 'Field Recordings' else 'Field Recording'
            who = f'{a["artist"]} - ' if a['artist'] else ''
            work_title = f'{genre_name}: {who}{a["album"]}' + (f' ({a["year"]})' if a['year'] else '')
            fields = [f'id: "{wid}"', f'title: {yaml_string(work_title)}', 'medium: album']
            if a['cover']:
                fields.append(f'cover: {yaml_string(a["cover"])}')
            if a['tracks']:
                fields.append(f'tracks: {a["tracks"]}')
            # What the randomizer's card opens: a YouTube search, which finds something for any album.
            fields.append(f'url: {yaml_string(a["youtube"])}')
            entries[-1] += '\n          - { ' + ', '.join(fields) + ' }'

    tree_lines = []
    for family, (name, pillar) in FAMILIES.items():
        p = nodes[pillar]
        tree_lines.append(f'    - {{ id: {family}, name: {yaml_string(name)}, icon: {p["icon"]}, sector: {p["sector"]}, requires: [ {{ node: [{pillar}] }} ] }}')
    for gid in order:
        name, parent = genres[gid]
        p = nodes.get(parent) or nodes[FAMILIES[parent][1]]
        tree_lines.append(f'    - {{ id: {gid}, name: {yaml_string(name)}, icon: {p["icon"]}, sector: {p["sector"]}, requires: [ {{ node: [{parent}] }} ] }}')

    # What an earlier run put here goes, so a run can be repeated.
    head, tree = mucore_parts()
    head = head.rstrip('\n') + f'\n{MARK}\n' + '\n'.join(entries) + '\n\n'
    tree = tree.rstrip('\n') + f'\n    {MARK}\n' + '\n'.join(tree_lines) + '\n'
    with open(MUCORE, 'w', encoding='utf-8') as f:
        f.write(head + 'tree:\n' + tree)
    print(f'Added {len(order)} genre entries and {sum(len(placed[g]) for g in order)} albums to {MUCORE}')


if __name__ == '__main__':
    main()
