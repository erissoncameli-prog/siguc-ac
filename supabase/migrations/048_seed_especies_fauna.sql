-- ═══════════════════════════════════════════════════════════
-- SIGUC-AC · Catálogo de Espécies — Fauna do Acre / Amazônia
-- Fontes: Portaria MMA 148/2022 · IUCN Red List 2023 · ICMBio
-- Foco: espécies encontradas em operações de brigada no Acre
-- Idempotente: ON CONFLICT DO NOTHING
-- ═══════════════════════════════════════════════════════════

-- Status: CR=Criticamente Ameaçada EN=Em Perigo VU=Vulnerável
--         NT=Quase Ameaçada  LC=Menos Preocupante  DD=Dados Insuficientes
-- ameacada = true para CR, EN, VU (lista MMA/IUCN)

-- ── MAMÍFEROS ─────────────────────────────────────────────────
INSERT INTO especies_fauna
  (nome_cientifico, nomes_populares, classe, ordem, familia, status_conservacao, ameacada, porte, versao_catalogo)
VALUES
-- Felinos
('Panthera onca',           ARRAY['onça-pintada','jaguar'],                            'mamifero','Carnivora','Felidae','VU',true, 'grande','MMA-148/2022'),
('Puma concolor',           ARRAY['onça-parda','suçuarana','puma'],                    'mamifero','Carnivora','Felidae','VU',true, 'grande','MMA-148/2022'),
('Leopardus pardalis',      ARRAY['jaguatirica','gato-maracajá-grande'],               'mamifero','Carnivora','Felidae','LC',false,'medio', 'IUCN-2023'),
('Leopardus wiedii',        ARRAY['maracajá','gato-maracajá'],                         'mamifero','Carnivora','Felidae','NT',false,'pequeno','MMA-148/2022'),
('Puma yagouaroundi',       ARRAY['gato-mourisco','gato-mourisco-amazônico'],          'mamifero','Carnivora','Felidae','LC',false,'pequeno','IUCN-2023'),
('Leopardus tigrinus',      ARRAY['gato-do-mato-pequeno','oncinha'],                   'mamifero','Carnivora','Felidae','VU',true, 'pequeno','MMA-148/2022'),
-- Canídeos / mustelídeos
('Speothos venaticus',      ARRAY['cachorro-vinagre','cachorro-do-mato-vinagre'],      'mamifero','Carnivora','Canidae','VU',true, 'pequeno','MMA-148/2022'),
('Atelocynus microtis',     ARRAY['cachorro-do-mato-de-orelhas-curtas'],               'mamifero','Carnivora','Canidae','NT',false,'pequeno','MMA-148/2022'),
('Pteronura brasiliensis',  ARRAY['ariranha','lontra-gigante'],                        'mamifero','Carnivora','Mustelidae','EN',true,'grande','MMA-148/2022'),
('Lontra longicaudis',      ARRAY['lontra','lontra-neotropical'],                      'mamifero','Carnivora','Mustelidae','NT',false,'medio','MMA-148/2022'),
('Eira barbara',            ARRAY['irara','papa-mel'],                                 'mamifero','Carnivora','Mustelidae','LC',false,'medio','IUCN-2023'),
('Galictis vittata',        ARRAY['furão','furão-grande'],                             'mamifero','Carnivora','Mustelidae','LC',false,'pequeno','IUCN-2023'),
-- Primatas
('Ateles chamek',           ARRAY['macaco-aranha-preto','coatá-preto'],                'mamifero','Primates','Atelidae','EN',true,'grande','MMA-148/2022'),
('Lagothrix cana',          ARRAY['barrigudo','macaco-barrigudo'],                     'mamifero','Primates','Atelidae','VU',true,'grande','MMA-148/2022'),
('Alouatta seniculus',      ARRAY['guariba','bugio-vermelho','macaco-uivador'],        'mamifero','Primates','Atelidae','LC',false,'grande','IUCN-2023'),
('Cacajao calvus',          ARRAY['uacari-branco'],                                    'mamifero','Primates','Pitheciidae','VU',true,'medio','MMA-148/2022'),
('Callimico goeldii',       ARRAY['soim-de-goeldi','saguim-de-goeldi'],               'mamifero','Primates','Callitrichidae','VU',true,'pequeno','MMA-148/2022'),
('Saguinus imperator',      ARRAY['sauim-imperador','mico-imperador'],                 'mamifero','Primates','Callitrichidae','LC',false,'pequeno','IUCN-2023'),
('Saguinus fuscicollis',    ARRAY['soim','mico-leãozinho'],                            'mamifero','Primates','Callitrichidae','LC',false,'pequeno','IUCN-2023'),
('Cebuella pygmaea',        ARRAY['leãozinho','mico-leão-pigmeu'],                    'mamifero','Primates','Callitrichidae','LC',false,'pequeno','IUCN-2023'),
('Cebus albifrons',         ARRAY['macaco-prego-galego','macaco-prego-de-fronte-branca'],'mamifero','Primates','Cebidae','LC',false,'medio','IUCN-2023'),
('Saimiri boliviensis',     ARRAY['macaco-de-cheiro','saimiri'],                       'mamifero','Primates','Cebidae','LC',false,'pequeno','IUCN-2023'),
('Pithecia irrorata',       ARRAY['parauacu','saguim-de-mão-branca'],                 'mamifero','Primates','Pitheciidae','LC',false,'medio','IUCN-2023'),
('Callicebus brunneus',     ARRAY['zogue-zogue','titi'],                               'mamifero','Primates','Pitheciidae','LC',false,'pequeno','IUCN-2023'),
-- Ungulados / grandes herbívoros
('Tapirus terrestris',      ARRAY['anta','tapir'],                                     'mamifero','Perissodactyla','Tapiridae','VU',true,'grande','MMA-148/2022'),
('Tayassu pecari',          ARRAY['queixada','porco-do-mato-grande'],                  'mamifero','Artiodactyla','Tayassuidae','VU',true,'grande','MMA-148/2022'),
('Pecari tajacu',           ARRAY['caititu','porco-do-mato'],                          'mamifero','Artiodactyla','Tayassuidae','LC',false,'medio','IUCN-2023'),
('Mazama americana',        ARRAY['veado-mateiro','veado-vermelho'],                   'mamifero','Artiodactyla','Cervidae','DD',false,'medio','IUCN-2023'),
('Mazama nemorivaga',       ARRAY['veado-fuboca','veado-da-mata'],                     'mamifero','Artiodactyla','Cervidae','DD',false,'medio','IUCN-2023'),
-- Edentados
('Myrmecophaga tridactyla', ARRAY['tamanduá-bandeira','tamanduá-grande'],              'mamifero','Pilosa','Myrmecophagidae','VU',true,'grande','MMA-148/2022'),
('Tamandua tetradactyla',   ARRAY['tamanduá-mirim','tamanduá-de-colete'],              'mamifero','Pilosa','Myrmecophagidae','LC',false,'medio','IUCN-2023'),
('Cyclopes didactylus',     ARRAY['tamanduaí','tamanduazinho'],                        'mamifero','Pilosa','Cyclopedidae','LC',false,'pequeno','IUCN-2023'),
('Bradypus tridactylus',    ARRAY['preguiça-de-três-dedos','preguiça-dos-pombos'],    'mamifero','Pilosa','Bradypodidae','LC',false,'medio','IUCN-2023'),
('Choloepus didactylus',    ARRAY['preguiça-de-dois-dedos','unau'],                   'mamifero','Pilosa','Megalonychidae','LC',false,'medio','IUCN-2023'),
('Priodontes maximus',      ARRAY['tatu-canastra','tatu-gigante'],                     'mamifero','Cingulata','Chlamyphoridae','VU',true,'grande','MMA-148/2022'),
('Cabassous unicinctus',    ARRAY['tatu-de-rabo-mole','tatu-de-cauda-nua'],           'mamifero','Cingulata','Chlamyphoridae','LC',false,'medio','IUCN-2023'),
('Dasypus novemcinctus',    ARRAY['tatu-galinha','tatu'],                              'mamifero','Cingulata','Dasypodidae','LC',false,'medio','IUCN-2023'),
-- Roedores / lagomorfos
('Dinomys branickii',       ARRAY['pacarana'],                                         'mamifero','Rodentia','Dinomyidae','VU',true,'grande','MMA-148/2022'),
('Hydrochoerus hydrochaeris',ARRAY['capivara'],                                        'mamifero','Rodentia','Caviidae','LC',false,'grande','IUCN-2023'),
('Cuniculus paca',          ARRAY['paca','paca-amazônica'],                            'mamifero','Rodentia','Cuniculidae','LC',false,'medio','IUCN-2023'),
('Dasyprocta variegata',    ARRAY['cutia'],                                             'mamifero','Rodentia','Dasyproctidae','LC',false,'medio','IUCN-2023'),
('Myoprocta acouchy',       ARRAY['caxixi','acuchy'],                                  'mamifero','Rodentia','Dasyproctidae','LC',false,'pequeno','IUCN-2023'),
-- Cetáceos / sirenídeos
('Inia geoffrensis',        ARRAY['boto-cor-de-rosa','boto','bouto'],                  'mamifero','Cetacea','Iniidae','EN',true,'grande','MMA-148/2022'),
('Sotalia fluviatilis',     ARRAY['tucuxi','golfinho-amazônico'],                      'mamifero','Cetacea','Delphinidae','EN',true,'medio','MMA-148/2022'),
('Trichechus inunguis',     ARRAY['peixe-boi-da-amazônia','manati'],                   'mamifero','Sirenia','Trichechidae','VU',true,'grande','MMA-148/2022'),
-- Marsupiais
('Didelphis marsupialis',   ARRAY['gambá','mucura','sariguê'],                         'mamifero','Didelphimorphia','Didelphidae','LC',false,'medio','IUCN-2023'),
('Philander opossum',       ARRAY['cuíca-de-quatro-olhos'],                            'mamifero','Didelphimorphia','Didelphidae','LC',false,'pequeno','IUCN-2023'),
('Caluromys lanatus',       ARRAY['cuíca-lanuda','gambá-da-floresta'],                 'mamifero','Didelphimorphia','Didelphidae','LC',false,'pequeno','IUCN-2023'),
-- Quirópteros
('Desmodus rotundus',       ARRAY['morcego-vampiro','vampiro-comum'],                  'mamifero','Chiroptera','Phyllostomidae','LC',false,'pequeno','IUCN-2023'),
('Artibeus planirostris',   ARRAY['morcego-da-fruta','morcego-frugívoro'],             'mamifero','Chiroptera','Phyllostomidae','LC',false,'pequeno','IUCN-2023')
ON CONFLICT (nome_cientifico) DO NOTHING;

-- ── AVES ──────────────────────────────────────────────────────
INSERT INTO especies_fauna
  (nome_cientifico, nomes_populares, classe, ordem, familia, status_conservacao, ameacada, porte, versao_catalogo)
VALUES
-- Rapinantes
('Harpia harpyja',          ARRAY['gavião-real','harpia'],                             'ave','Accipitriformes','Accipitridae','VU',true, 'grande','MMA-148/2022'),
('Morphnus guianensis',     ARRAY['uiraçu-falso','gavião-real-falso'],                 'ave','Accipitriformes','Accipitridae','NT',false,'grande','MMA-148/2022'),
('Spizaetus ornatus',       ARRAY['gavião-de-penacho','pato-do-mato'],                 'ave','Accipitriformes','Accipitridae','LC',false,'grande','IUCN-2023'),
('Spizaetus isidori',       ARRAY['gavião-de-penacho-negro'],                          'ave','Accipitriformes','Accipitridae','EN',true, 'grande','MMA-148/2022'),
('Accipiter bicolor',       ARRAY['gavião-bombachinha-grande'],                        'ave','Accipitriformes','Accipitridae','LC',false,'medio','IUCN-2023'),
('Busarellus nigricollis',  ARRAY['gavião-do-igapó','gaviãozinho'],                   'ave','Accipitriformes','Accipitridae','LC',false,'medio','IUCN-2023'),
('Leucopternis schistaceus',ARRAY['gavião-azul'],                                      'ave','Accipitriformes','Accipitridae','LC',false,'medio','IUCN-2023'),
('Vultur gryphus',          ARRAY['condor-dos-andes'],                                 'ave','Cathartiformes','Cathartidae','VU',true,'grande','MMA-148/2022'),
('Sarcoramphus papa',       ARRAY['urubu-rei','rei-dos-abutres'],                      'ave','Cathartiformes','Cathartidae','LC',false,'grande','IUCN-2023'),
-- Cracídeos (mutuns, jacutingas)
('Crax globulosa',          ARRAY['mutum-de-fava','mutum-do-juruá'],                   'ave','Galliformes','Cracidae','VU',true, 'grande','MMA-148/2022'),
('Crax fasciolata',         ARRAY['mutum-de-penacho','mutum'],                         'ave','Galliformes','Cracidae','VU',true, 'grande','MMA-148/2022'),
('Mitu tuberosum',          ARRAY['mutum-cavalo','mutum-de-fava-do-acre'],             'ave','Galliformes','Cracidae','LC',false,'grande','IUCN-2023'),
('Pauxi tuberosa',          ARRAY['mutum-de-crista-azul'],                             'ave','Galliformes','Cracidae','NT',false,'grande','MMA-148/2022'),
('Pipile cumanensis',       ARRAY['jacutinga-de-garganta-azul','jacutinga'],           'ave','Galliformes','Cracidae','LC',false,'grande','IUCN-2023'),
('Penelope purpurascens',   ARRAY['jacupemba'],                                        'ave','Galliformes','Cracidae','LC',false,'grande','IUCN-2023'),
('Penelope jacquacu',       ARRAY['jacamim-de-costas-vermelhas','jacu'],               'ave','Galliformes','Cracidae','LC',false,'grande','IUCN-2023'),
('Ortalis guttata',         ARRAY['aracuã-pintada','aracuã'],                          'ave','Galliformes','Cracidae','LC',false,'medio','IUCN-2023'),
-- Tinamídeos (inambus)
('Tinamus osgoodi',         ARRAY['inambu-preto'],                                     'ave','Tinamiformes','Tinamidae','EN',true,'grande','MMA-148/2022'),
('Tinamus major',           ARRAY['inambu-grande','macuco-da-amazônia'],               'ave','Tinamiformes','Tinamidae','LC',false,'grande','IUCN-2023'),
('Crypturellus undulatus',  ARRAY['inambu-anhangá','jaó'],                             'ave','Tinamiformes','Tinamidae','LC',false,'medio','IUCN-2023'),
-- Psitacídeos (araras, periquitos, papagaios)
('Ara macao',               ARRAY['arara-vermelha','arara-piranga'],                   'ave','Psittaciformes','Psittacidae','LC',false,'grande','IUCN-2023'),
('Ara chloropterus',        ARRAY['arara-vermelha-grande','araraúna-vermelha'],        'ave','Psittaciformes','Psittacidae','LC',false,'grande','IUCN-2023'),
('Ara ararauna',            ARRAY['arara-canindé','araraúna'],                         'ave','Psittaciformes','Psittacidae','LC',false,'grande','IUCN-2023'),
('Ara severus',             ARRAY['maracanã-guaçu'],                                   'ave','Psittaciformes','Psittacidae','LC',false,'medio','IUCN-2023'),
('Orthopsittaca manilatus', ARRAY['maracanã-do-buriti','arara-do-buriti'],             'ave','Psittaciformes','Psittacidae','LC',false,'medio','IUCN-2023'),
('Amazona farinosa',        ARRAY['papagaio-moleiro','cuiuba'],                        'ave','Psittaciformes','Psittacidae','LC',false,'medio','IUCN-2023'),
('Amazona ochrocephala',    ARRAY['papagaio-de-cabeça-amarela','papagaio-real'],       'ave','Psittaciformes','Psittacidae','LC',false,'medio','IUCN-2023'),
('Amazona amazonica',       ARRAY['curica','papagaio-curicas'],                        'ave','Psittaciformes','Psittacidae','LC',false,'medio','IUCN-2023'),
('Pionus menstruus',        ARRAY['maitaca-de-cabeça-azul','maitaca'],                'ave','Psittaciformes','Psittacidae','LC',false,'medio','IUCN-2023'),
('Brotogeris cyanoptera',   ARRAY['maritaca-de-asa-azul','periquito-de-asa-azul'],   'ave','Psittaciformes','Psittacidae','LC',false,'pequeno','IUCN-2023'),
('Touit purpuratus',        ARRAY['apuim-de-costas-azuis'],                            'ave','Psittaciformes','Psittacidae','LC',false,'pequeno','IUCN-2023'),
-- Tucanos / ranfastídeos
('Ramphastos tucanus',      ARRAY['tucano-de-papo-branco','tucano-grande'],            'ave','Piciformes','Ramphastidae','LC',false,'grande','IUCN-2023'),
('Ramphastos vitellinus',   ARRAY['tucano-de-bico-preto','tucano-ranfo'],              'ave','Piciformes','Ramphastidae','VU',true,'grande','MMA-148/2022'),
('Pteroglossus castanotis', ARRAY['araçari-de-orelha-castanha','araçari'],             'ave','Piciformes','Ramphastidae','LC',false,'medio','IUCN-2023'),
('Selenidera reinwardtii',  ARRAY['tucano-de-bico-listrado'],                          'ave','Piciformes','Ramphastidae','LC',false,'pequeno','IUCN-2023'),
-- Ciconídeos / ardeídeos
('Jabiru mycteria',         ARRAY['tuiuiú','jaburu'],                                  'ave','Ciconiiformes','Ciconiidae','LC',false,'grande','IUCN-2023'),
('Agamia agami',            ARRAY['garça-da-mata','garça-agami'],                      'ave','Pelecaniformes','Ardeidae','VU',true,'medio','MMA-148/2022'),
('Ardea cocoi',             ARRAY['garça-moura','maguari'],                            'ave','Pelecaniformes','Ardeidae','LC',false,'grande','IUCN-2023'),
('Ardea alba',              ARRAY['garça-branca-grande'],                              'ave','Pelecaniformes','Ardeidae','LC',false,'grande','IUCN-2023'),
('Cochlearius cochlearius',  ARRAY['arapapá','garça-martelo'],                         'ave','Pelecaniformes','Ardeidae','LC',false,'medio','IUCN-2023'),
-- Traupídeos e outros
('Cotinga cayana',          ARRAY['cotinga-azul','andorinha-do-mato'],                 'ave','Passeriformes','Cotingidae','LC',false,'pequeno','IUCN-2023'),
('Rupicola rupicola',       ARRAY['galo-da-serra','galo-da-pedra'],                    'ave','Passeriformes','Cotingidae','LC',false,'pequeno','IUCN-2023'),
('Pheucticus aureoventris', ARRAY['rei-do-bosque'],                                    'ave','Passeriformes','Cardinalidae','LC',false,'pequeno','IUCN-2023'),
('Ramphocelus carbo',       ARRAY['pipira-vermelha'],                                  'ave','Passeriformes','Thraupidae','LC',false,'pequeno','IUCN-2023'),
-- Columbídeos
('Patagioenas subvinacea',  ARRAY['pomba-trocal'],                                     'ave','Columbiformes','Columbidae','VU',true,'medio','MMA-148/2022'),
('Claravis pretiosa',       ARRAY['rolinha-azul'],                                     'ave','Columbiformes','Columbidae','LC',false,'pequeno','IUCN-2023'),
-- Trogonídeos
('Pharomachrus pavoninus',  ARRAY['surucuá-pavão','quetzal'],                          'ave','Trogoniformes','Trogonidae','LC',false,'medio','IUCN-2023'),
-- Jacamídeos / mamanases
('Jacamerops aureus',       ARRAY['jacamar-de-cauda-grande'],                          'ave','Piciformes','Galbulidae','LC',false,'pequeno','IUCN-2023'),
-- Psofídeos
('Psophia leucoptera',      ARRAY['jacamim-de-costas-brancas','jacamim'],              'ave','Gruiformes','Psophiidae','VU',true,'grande','MMA-148/2022')
ON CONFLICT (nome_cientifico) DO NOTHING;

-- ── RÉPTEIS ───────────────────────────────────────────────────
INSERT INTO especies_fauna
  (nome_cientifico, nomes_populares, classe, ordem, familia, status_conservacao, ameacada, porte, versao_catalogo)
VALUES
-- Crocodilos
('Melanosuchus niger',      ARRAY['jacaré-açu','jacaré-preto'],                        'reptil','Crocodylia','Alligatoridae','LC',false,'grande','IUCN-2023'),
('Caiman crocodilus',       ARRAY['jacaré-tinga','jacaré-branco'],                     'reptil','Crocodylia','Alligatoridae','LC',false,'grande','IUCN-2023'),
('Paleosuchus trigonatus',  ARRAY['jacaré-coroa','caimão-de-helmeted'],               'reptil','Crocodylia','Alligatoridae','LC',false,'medio','IUCN-2023'),
('Paleosuchus palpebrosus', ARRAY['jacaré-do-juruá','jacaré-anão'],                   'reptil','Crocodylia','Alligatoridae','LC',false,'medio','IUCN-2023'),
-- Tartarugas / quelônios
('Podocnemis expansa',      ARRAY['tartaruga-da-amazônia','tartaruga-grande'],         'reptil','Testudines','Podocnemididae','VU',true,'grande','MMA-148/2022'),
('Podocnemis unifilis',     ARRAY['tracajá','tartaruga-do-rio'],                       'reptil','Testudines','Podocnemididae','VU',true,'medio','MMA-148/2022'),
('Podocnemis sextuberculata',ARRAY['seis-malhas','iaçá'],                              'reptil','Testudines','Podocnemididae','NT',false,'medio','MMA-148/2022'),
('Chelonoidis denticulata', ARRAY['jabuti-amarelo','jabuti-dos-pés-amarelos'],         'reptil','Testudines','Testudinidae','VU',true,'medio','MMA-148/2022'),
('Chelonoidis carbonaria',  ARRAY['jabuti-piranga','jabuti-vermelho'],                 'reptil','Testudines','Testudinidae','VU',true,'medio','MMA-148/2022'),
('Platemys platycephala',   ARRAY['cágado-de-cabeça-achatada'],                        'reptil','Testudines','Chelidae','LC',false,'pequeno','IUCN-2023'),
('Kinosternon scorpioides', ARRAY['muçuã','matamatá-pequeno'],                        'reptil','Testudines','Kinosternidae','LC',false,'pequeno','IUCN-2023'),
('Phrynops rufipes',        ARRAY['cágado-vermelho'],                                  'reptil','Testudines','Chelidae','NT',false,'medio','MMA-148/2022'),
-- Serpentes
('Eunectes murinus',        ARRAY['sucuri','anaconda','sucuri-verde'],                 'reptil','Squamata','Boidae','LC',false,'grande','IUCN-2023'),
('Boa constrictor',         ARRAY['jiboia','boa'],                                     'reptil','Squamata','Boidae','LC',false,'grande','IUCN-2023'),
('Corallus hortulana',      ARRAY['suaçuboia','cobra-da-árvore'],                      'reptil','Squamata','Boidae','LC',false,'medio','IUCN-2023'),
('Bothrops atrox',          ARRAY['jararaca-da-amazônia','jararaca'],                  'reptil','Squamata','Viperidae','LC',false,'medio','IUCN-2023'),
('Bothrops bilineatus',     ARRAY['jararaca-verde','surucucu-do-pantanal'],            'reptil','Squamata','Viperidae','LC',false,'medio','IUCN-2023'),
('Lachesis muta',           ARRAY['surucucu','surucutinga','surucucu-pico-de-jaca'],   'reptil','Squamata','Viperidae','LC',false,'grande','IUCN-2023'),
('Micrurus lemniscatus',    ARRAY['coral-verdadeira','cobra-coral'],                   'reptil','Squamata','Elapidae','LC',false,'pequeno','IUCN-2023'),
('Epicrates cenchria',      ARRAY['arco-íris','jiboinha-arco-íris'],                  'reptil','Squamata','Boidae','LC',false,'medio','IUCN-2023'),
-- Lagartos
('Iguana iguana',           ARRAY['iguana','camaleão','sinimbu'],                      'reptil','Squamata','Iguanidae','LC',false,'medio','IUCN-2023'),
('Tupinambis teguixin',     ARRAY['teiú','tejuaçu'],                                   'reptil','Squamata','Teiidae','LC',false,'grande','IUCN-2023'),
('Dracaena guianensis',     ARRAY['jacuraru-do-papo-laranja','calango-dos-rios'],      'reptil','Squamata','Teiidae','LC',false,'medio','IUCN-2023'),
('Caiman latirostris',      ARRAY['jacaré-do-papo-amarelo'],                           'reptil','Crocodylia','Alligatoridae','LC',false,'grande','IUCN-2023')
ON CONFLICT (nome_cientifico) DO NOTHING;

-- ── ANFÍBIOS ──────────────────────────────────────────────────
INSERT INTO especies_fauna
  (nome_cientifico, nomes_populares, classe, ordem, familia, status_conservacao, ameacada, porte, versao_catalogo)
VALUES
('Rhinella marina',         ARRAY['sapo-cururu','sapo-boi'],                           'anfibio','Anura','Bufonidae','LC',false,'medio','IUCN-2023'),
('Rhinella margaritifera',  ARRAY['sapo-da-floresta'],                                  'anfibio','Anura','Bufonidae','LC',false,'pequeno','IUCN-2023'),
('Phyllomedusa bicolor',    ARRAY['kambô','perereca-macaco-gigante','kampu'],          'anfibio','Anura','Phyllomedusidae','LC',false,'medio','IUCN-2023'),
('Phyllomedusa vaillantii', ARRAY['perereca-de-leite','perereca-verde'],               'anfibio','Anura','Phyllomedusidae','LC',false,'pequeno','IUCN-2023'),
('Osteocephalus taurinus',  ARRAY['perereca-de-capacete','rã-arborícola'],             'anfibio','Anura','Hylidae','LC',false,'pequeno','IUCN-2023'),
('Osteocephalus leprieurii',ARRAY['perereca-da-floresta'],                              'anfibio','Anura','Hylidae','LC',false,'pequeno','IUCN-2023'),
('Hypsiboas boans',         ARRAY['perereca-gigante-amazônica'],                        'anfibio','Anura','Hylidae','LC',false,'medio','IUCN-2023'),
('Hypsiboas fasciatus',     ARRAY['perereca-listrada'],                                 'anfibio','Anura','Hylidae','LC',false,'pequeno','IUCN-2023'),
('Ranitomeya amazonica',    ARRAY['rãzinha-venenosa','dendrobatídeo-amazônico'],       'anfibio','Anura','Dendrobatidae','LC',false,'pequeno','IUCN-2023'),
('Allobates femoralis',     ARRAY['rã-de-seta','dendrobatídeo'],                       'anfibio','Anura','Dendrobatidae','LC',false,'pequeno','IUCN-2023'),
('Ceratophrys cornuta',     ARRAY['rã-de-chifre','rã-touro'],                          'anfibio','Anura','Ceratophryidae','LC',false,'medio','IUCN-2023'),
('Leptodactylus pentadactylus',ARRAY['rã-pimenta','rã-boi','rã-grande'],              'anfibio','Anura','Leptodactylidae','LC',false,'medio','IUCN-2023'),
('Leptodactylus bolivianus',ARRAY['rã-comum','rã-do-acre'],                            'anfibio','Anura','Leptodactylidae','LC',false,'pequeno','IUCN-2023'),
('Pipa pipa',               ARRAY['pipa-amazônica','sapo-narina'],                     'anfibio','Anura','Pipidae','LC',false,'medio','IUCN-2023'),
('Caecilia tentaculata',    ARRAY['cobra-cega','cecília'],                              'anfibio','Gymnophiona','Caeciliidae','LC',false,'pequeno','IUCN-2023')
ON CONFLICT (nome_cientifico) DO NOTHING;

-- ── PEIXES ────────────────────────────────────────────────────
INSERT INTO especies_fauna
  (nome_cientifico, nomes_populares, classe, ordem, familia, status_conservacao, ameacada, porte, versao_catalogo)
VALUES
('Arapaima gigas',               ARRAY['pirarucu','arapaima'],                         'peixe','Osteoglossiformes','Arapaimidae','DD',false,'grande','IUCN-2023'),
('Colossoma macropomum',         ARRAY['tambaqui','pacu-tambaqui'],                   'peixe','Characiformes','Serrasalmidae','DD',false,'grande','IUCN-2023'),
('Brachyplatystoma vaillantii',  ARRAY['dourada','dourado-do-rio'],                   'peixe','Siluriformes','Pimelodidae','EN',true, 'grande','MMA-148/2022'),
('Brachyplatystoma rousseauxii', ARRAY['filhote','piraíba','dourada-grande'],         'peixe','Siluriformes','Pimelodidae','EN',true, 'grande','MMA-148/2022'),
('Brachyplatystoma juruense',    ARRAY['jundiá-zebra','cangati-zebra'],               'peixe','Siluriformes','Pimelodidae','EN',true, 'medio','MMA-148/2022'),
('Brachyplatystoma platynemum',  ARRAY['babão','mandi-babão'],                        'peixe','Siluriformes','Pimelodidae','VU',true, 'grande','MMA-148/2022'),
('Pseudoplatystoma tigrinum',    ARRAY['pintado','surubim-tigre'],                    'peixe','Siluriformes','Pimelodidae','LC',false,'grande','IUCN-2023'),
('Pseudoplatystoma fasciatum',   ARRAY['surubim','cachara'],                          'peixe','Siluriformes','Pimelodidae','LC',false,'grande','IUCN-2023'),
('Hypophthalmus edentatus',      ARRAY['mapará','mapará-do-amazonas'],                'peixe','Siluriformes','Hypophthalmidae','LC',false,'medio','IUCN-2023'),
('Prochilodus nigricans',        ARRAY['curimatã','jaraqui-escama-grossa'],           'peixe','Characiformes','Prochilodontidae','LC',false,'medio','IUCN-2023'),
('Semaprochilodus insignis',     ARRAY['jaraqui','jaraqui-escama-fina'],              'peixe','Characiformes','Prochilodontidae','LC',false,'medio','IUCN-2023'),
('Plagioscion squamosissimus',   ARRAY['pescada-branca','corvina-amazônica'],         'peixe','Perciformes','Sciaenidae','LC',false,'medio','IUCN-2023'),
('Cichla monoculus',             ARRAY['tucunaré','tucunaré-açu'],                   'peixe','Perciformes','Cichlidae','LC',false,'medio','IUCN-2023'),
('Electrophorus electricus',     ARRAY['poraquê','enguia-elétrica'],                 'peixe','Gymnotiformes','Gymnotidae','LC',false,'grande','IUCN-2023'),
('Potamotrygon motoro',          ARRAY['arraia','raia-de-água-doce'],                 'peixe','Myliobatiformes','Potamotrygonidae','LC',false,'medio','IUCN-2023'),
('Piaractus brachypomus',        ARRAY['pacu','pirapitinga'],                         'peixe','Characiformes','Serrasalmidae','LC',false,'grande','IUCN-2023'),
('Serrasalmus rhombeus',         ARRAY['piranha-branca','piranha-preta'],             'peixe','Characiformes','Serrasalmidae','LC',false,'medio','IUCN-2023'),
('Pellona castelnaeana',         ARRAY['apapá-branco','apapá'],                       'peixe','Clupeiformes','Pellonidae','LC',false,'medio','IUCN-2023')
ON CONFLICT (nome_cientifico) DO NOTHING;

-- ── INVERTEBRADOS ─────────────────────────────────────────────
INSERT INTO especies_fauna
  (nome_cientifico, nomes_populares, classe, ordem, familia, status_conservacao, ameacada, porte, versao_catalogo)
VALUES
('Morpho menelaus',         ARRAY['borboleta-azul','morpho'],                          'invertebrado','Lepidoptera','Nymphalidae','LC',false,'pequeno','IUCN-2023'),
('Dynastes hercules',       ARRAY['besouro-hércules'],                                 'invertebrado','Coleoptera','Dynastidae','LC',false,'pequeno','IUCN-2023'),
('Titanus giganteus',       ARRAY['longicórnio-gigante','besouro-gigante'],            'invertebrado','Coleoptera','Cerambycidae','DD',false,'medio','IUCN-2023'),
('Theraphosa blondi',       ARRAY['tarântula-golias','caranguejeira-gigante'],         'invertebrado','Araneae','Theraphosidae','LC',false,'medio','IUCN-2023'),
('Acromyrmex lundi',        ARRAY['saúva','cortadeira'],                               'invertebrado','Hymenoptera','Formicidae','LC',false,'pequeno','IUCN-2023'),
('Macrobrachium amazonicum',ARRAY['camarão-canela','camarão-da-amazônia'],             'invertebrado','Decapoda','Palaemonidae','LC',false,'pequeno','IUCN-2023'),
('Podocoryna carnea',       ARRAY['coral-de-água-doce'],                               'invertebrado','Anthoathecata','Hydractiniidae','LC',false,'pequeno','IUCN-2023'),
('Dilocarcinus pagei',      ARRAY['siri-de-água-doce','caranguejo-amazônico'],         'invertebrado','Decapoda','Trichodactylidae','LC',false,'pequeno','IUCN-2023')
ON CONFLICT (nome_cientifico) DO NOTHING;

-- Atualiza contagem para verificação
DO $$
DECLARE v_total int; v_ameacadas int;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE ameacada) INTO v_total, v_ameacadas FROM especies_fauna;
  RAISE NOTICE 'Catálogo: % espécies carregadas (% ameaçadas)', v_total, v_ameacadas;
END $$;
