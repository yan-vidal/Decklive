//! Textos prontos para exibir sobre a foto: local, título e resumo (design D2 de
//! `add-photo-info-and-motion`). Funções puras; o catálogo as chama uma vez por versão
//! e por idioma (design D3 de `add-localized-descriptions`).

use crate::model::Media;

/// Local, título e resumo de uma foto, já prontos para o item da playlist.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Info {
    pub place: Option<String>,
    pub title: Option<String>,
    pub text: Option<String>,
}

/// Os dois-pontos do título têm de aparecer antes deste caractere (contado em `char`).
pub const TITLE_MAX_CHARS: usize = 80;
/// Tamanho máximo do resumo, sem contar o "…" do corte.
pub const SUMMARY_MAX_CHARS: usize = 240;

impl Info {
    /// Textos em inglês, como vêm da origem.
    pub fn of(m: &Media) -> Self {
        Self::localized(m, |_| None)
    }

    /// Textos num idioma: `lookup` devolve a tradução de um texto da origem (já sem
    /// espaços nas pontas), se houver. A descrição e cada parte do local são trocadas
    /// antes das regras de sempre; o que não tem tradução fica em inglês.
    pub fn localized<'a>(m: &'a Media, lookup: impl Fn(&str) -> Option<&'a str>) -> Self {
        // sem tradução, o texto segue como veio: `split_description` olha o fim dele
        let translate = |text: Option<&'a str>| text.map(|t| lookup(t.trim()).unwrap_or(t));
        let (title, text) = match translate(m.description.as_deref()) {
            Some(desc) => {
                let (title, rest) = split_description(desc);
                (title.map(String::from), summary(rest))
            }
            None => (None, None),
        };
        Info {
            place: place(
                translate(m.city.as_deref()),
                translate(m.state.as_deref()),
                translate(m.country.as_deref()),
            ),
            title,
            text,
        }
    }
}

/// Cidade, estado e país numa linha, separados por vírgula. Pula as partes vazias e
/// não repete uma parte igual à anterior ("São Paulo, São Paulo" vira "São Paulo").
pub fn place(city: Option<&str>, state: Option<&str>, country: Option<&str>) -> Option<String> {
    let mut parts: Vec<&str> = Vec::with_capacity(3);
    for part in [city, state, country].into_iter().flatten().map(str::trim) {
        let repeated = parts
            .last()
            .is_some_and(|last| last.to_lowercase() == part.to_lowercase());
        if !part.is_empty() && !repeated {
            parts.push(part);
        }
    }
    (!parts.is_empty()).then(|| parts.join(", "))
}

/// Separa o título ("Título: texto") do resto da descrição. Há título quando o primeiro
/// `": "` aparece entre os primeiros 80 caracteres; sem ele, o resto é a descrição inteira.
pub fn split_description(desc: &str) -> (Option<&str>, &str) {
    // o fim fica como veio até a busca: "Título: " ainda tem título
    let desc = desc.trim_start();
    if let Some(i) = desc.find(": ")
        && desc[..i].chars().count() < TITLE_MAX_CHARS
    {
        let title = desc[..i].trim();
        if !title.is_empty() {
            return (Some(title), desc[i + 2..].trim());
        }
    }
    (None, desc.trim_end())
}

/// Primeira frase do texto, com a primeira letra maiúscula e no máximo 240 caracteres
/// (mais o "…" do corte). Sem texto, `None`.
pub fn summary(rest: &str) -> Option<String> {
    let sentence = first_sentence(rest.trim()).trim_end();
    if sentence.is_empty() {
        return None;
    }
    Some(shorten(&capitalize(sentence)))
}

/// Aspas e parêntese que podem fechar a frase depois do ponto.
fn is_closer(c: char) -> bool {
    matches!(c, '"' | '”' | '’' | ')')
}

/// Até o primeiro `.`, `!` ou `?` (com as aspas ou o parêntese que fecham logo depois)
/// seguido de espaço ou do fim do texto. Sem isso, o texto inteiro.
fn first_sentence(text: &str) -> &str {
    let mut chars = text.char_indices().peekable();
    while let Some((_, c)) = chars.next() {
        if !matches!(c, '.' | '!' | '?') {
            continue;
        }
        while chars.next_if(|&(_, c)| is_closer(c)).is_some() {}
        match chars.peek() {
            None => return text,
            Some(&(i, c)) if c.is_whitespace() => return &text[..i],
            Some(_) => {}
        }
    }
    text
}

/// Põe em maiúscula a primeira letra, pulando aspas e parênteses de abertura.
/// Se o texto começa com número, nada muda.
fn capitalize(text: &str) -> String {
    match text.char_indices().find(|(_, c)| c.is_alphanumeric()) {
        Some((i, c)) if c.is_lowercase() => {
            let mut out = String::with_capacity(text.len() + 2);
            out.push_str(&text[..i]);
            out.extend(c.to_uppercase());
            out.push_str(&text[i + c.len_utf8()..]);
            out
        }
        _ => text.to_string(),
    }
}

/// Corta no último espaço antes do limite e acrescenta "…". Conta em `char`, então
/// nunca parte um caractere acentuado ao meio.
fn shorten(text: &str) -> String {
    // byte em que começa o 241º caractere; sem ele, o texto cabe
    let Some((limit, next)) = text.char_indices().nth(SUMMARY_MAX_CHARS) else {
        return text.to_string();
    };
    let head = &text[..limit];
    let cut = if next.is_whitespace() {
        head
    } else {
        // uma palavra só, maior que o limite: corte seco
        head.rfind(char::is_whitespace).map_or(head, |i| &head[..i])
    };
    // pontuação de ligação não fica pendurada antes do "…"
    let cut = cut.trim_end_matches(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | ':'));
    let cut = if cut.is_empty() { head } else { cut };
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUNSET: &str = "Sunset Dune: This natural formation is part of the dynamic dune \
        system along the northeastern coast of Brazil. Constantly shaped by the wind…";
    const FORMIGA: &str = "Formiga Waterfall is a hidden gem located in the Jalapão region, \
        near Mateiros, Tocantins. This small but stunning waterfall…";

    #[test]
    fn place_table() {
        // cidade, estado, país e o local esperado
        type Case<'a> = (
            Option<&'a str>,
            Option<&'a str>,
            Option<&'a str>,
            Option<&'a str>,
        );
        let cases: &[Case] = &[
            // completo
            (
                Some("Jericoacoara"),
                Some("Ceará"),
                Some("Brazil"),
                Some("Jericoacoara, Ceará, Brazil"),
            ),
            // cidade igual ao estado
            (
                Some("São Paulo"),
                Some("São Paulo"),
                Some("Brazil"),
                Some("São Paulo, Brazil"),
            ),
            (
                Some("Osaka"),
                Some("Osaka"),
                Some("Japan"),
                Some("Osaka, Japan"),
            ),
            // só o país
            (None, None, Some("Japan"), Some("Japan")),
            // tudo vazio
            (None, None, None, None),
            (Some(""), Some("  "), Some("\t"), None),
            // partes vazias no meio e espaços nas pontas
            (
                Some("Penha"),
                Some(" "),
                Some("Brazil"),
                Some("Penha, Brazil"),
            ),
            (
                Some(" Paraná do Mamori "),
                Some("Amazonas"),
                None,
                Some("Paraná do Mamori, Amazonas"),
            ),
            // a repetição é comparada com a parte anterior que ficou
            (None, Some("Brazil"), Some("Brazil"), Some("Brazil")),
            (
                Some("Rio de Janeiro"),
                Some("rio de janeiro"),
                Some("Brazil"),
                Some("Rio de Janeiro, Brazil"),
            ),
            // partes iguais mas não vizinhas ficam
            (
                Some("Brazil"),
                Some("Goiás"),
                Some("Brazil"),
                Some("Brazil, Goiás, Brazil"),
            ),
        ];
        for &(city, state, country, expected) in cases {
            assert_eq!(
                place(city, state, country).as_deref(),
                expected,
                "{city:?}, {state:?}, {country:?}"
            );
        }
    }

    #[test]
    fn split_description_table() {
        let title_79 = format!("{}: resto", "ã".repeat(79));
        let title_80 = format!("{}: resto", "a".repeat(80));
        let cases: Vec<(&str, Option<&str>, &str)> = vec![
            // com título
            (
                SUNSET,
                Some("Sunset Dune"),
                "This natural formation is part of the dynamic dune system along the \
                 northeastern coast of Brazil. Constantly shaped by the wind…",
            ),
            (
                "Serra Verde Express, Train Ride from Curitiba to Morretes: one of Brazil’s",
                Some("Serra Verde Express, Train Ride from Curitiba to Morretes"),
                "one of Brazil’s",
            ),
            // sem título
            (FORMIGA, None, FORMIGA),
            // dois-pontos sem espaço depois não marcam título
            (
                "Opening hours:9 to 5. Free.",
                None,
                "Opening hours:9 to 5. Free.",
            ),
            // título vazio não é título
            (": text", None, ": text"),
            // espaços nas pontas
            (
                "  Morretes:  A charming town.  ",
                Some("Morretes"),
                "A charming town.",
            ),
            // só o título
            ("Morretes: ", Some("Morretes"), ""),
        ];
        for (desc, title, rest) in cases {
            assert_eq!(split_description(desc), (title, rest), "{desc:?}");
        }
        // 79 caracteres (158 bytes) antes dos dois-pontos: ainda é título
        let (title, rest) = split_description(&title_79);
        assert_eq!(title.map(|t| t.chars().count()), Some(79));
        assert_eq!(rest, "resto");
        // dois-pontos depois do caractere 80: sem título
        assert_eq!(
            split_description(&title_80),
            (None, title_80.as_str()),
            "título de 80 caracteres"
        );
    }

    /// Frase de `n` caracteres feita de palavras de `word`, terminada em ponto.
    fn sentence_of(word: &str, n: usize) -> String {
        let mut s = String::new();
        while s.chars().count() < n - 1 {
            if !s.is_empty() {
                s.push(' ');
            }
            s.push_str(word);
        }
        let s: String = s.chars().take(n - 1).collect();
        format!("{}.", s.trim_end())
    }

    #[test]
    fn summary_table() {
        let cases: &[(&str, Option<&str>)] = &[
            // primeira frase
            (
                "This natural formation is part of the dynamic dune system along the \
                 northeastern coast of Brazil. Constantly shaped by the wind…",
                Some(
                    "This natural formation is part of the dynamic dune system along the \
                     northeastern coast of Brazil.",
                ),
            ),
            // minúscula inicial
            (
                "housed in the historic Palace of Industries building, is dedicated to \
                 interactive science. Next.",
                Some(
                    "Housed in the historic Palace of Industries building, is dedicated to \
                     interactive science.",
                ),
            ),
            // aspas e parêntese que fecham a frase
            (
                "It is represented by a sculpture known as \"Marco Zero.\" This sculpture…",
                Some("It is represented by a sculpture known as \"Marco Zero.\""),
            ),
            (
                "He declared, “What a beautiful horizon!” The open space…",
                Some("He declared, “What a beautiful horizon!”"),
            ),
            (
                "It was rebuilt (twice.) Then…",
                Some("It was rebuilt (twice.)"),
            ),
            (
                "Built by Brazil’s navy.’ Next",
                Some("Built by Brazil’s navy.’"),
            ),
            ("Is it real? Yes.", Some("Is it real?")),
            ("Wow! Yes.", Some("Wow!")),
            // ponto sem espaço depois não termina a frase
            (
                "It covers 3.5 km of coast. Next.",
                Some("It covers 3.5 km of coast."),
            ),
            ("Visit yanlucas.com today", Some("Visit yanlucas.com today")),
            // reticências
            ("Wait... there is more.", Some("Wait...")),
            // sem pontuação final: o texto inteiro
            ("A short text", Some("A short text")),
            // aspas abrindo: a primeira letra é a de dentro
            (
                "\"postão beira-mar\" is a floating post. It serves boats.",
                Some("\"Postão beira-mar\" is a floating post."),
            ),
            // começa com número: nada a pôr em maiúscula
            ("18th-century church. Next.", Some("18th-century church.")),
            ("élan is rare. Next.", Some("Élan is rare.")),
            // quebra de linha também separa frases
            ("First.\nSecond.", Some("First.")),
            // sem texto
            ("", None),
            ("   ", None),
        ];
        for &(rest, expected) in cases {
            assert_eq!(summary(rest).as_deref(), expected, "{rest:?}");
        }
    }

    /// Confere o corte: até 241 caracteres, "…" no fim, sem partir palavra.
    fn assert_cut(original: &str, got: &str) {
        let n = got.chars().count();
        assert!(n <= 241, "{n} caracteres: {got}");
        let head = got.strip_suffix('…').expect("termina em …");
        assert!(original.starts_with(head), "{got}");
        let next = original[head.len()..].chars().next();
        assert!(
            matches!(next, Some(c) if c.is_whitespace() || c == ','),
            "cortou no meio de uma palavra: {got:?} / {next:?}"
        );
    }

    #[test]
    fn long_sentence_is_cut_at_a_space() {
        // frase de 300 caracteres
        let long = sentence_of("Landscape", 300);
        assert_eq!(long.chars().count(), 300);
        let got = summary(&format!("{long} Next.")).unwrap();
        assert_cut(&long, &got);
        assert!(got.chars().count() > 200, "cortou cedo demais: {got}");

        // com acentos perto do limite (2 bytes por caractere): não parte um caractere
        for shift in 0..8 {
            let long = format!("{}{}", "Z".repeat(shift), sentence_of("Ação", 300));
            let got = summary(&long).unwrap();
            assert_cut(&long, &got);
        }

        // "’" (3 bytes) em toda palavra
        let long = sentence_of("Brazil’s", 290);
        assert_cut(&long, &summary(&long).unwrap());

        // vírgula antes do corte não fica pendurada antes do "…"
        let long = format!("{}, {}", "Word ".repeat(47).trim_end(), "x".repeat(100));
        let got = summary(&long).unwrap();
        assert!(got.ends_with("Word…"), "{got}");
    }

    #[test]
    fn sentence_at_the_limit_is_kept() {
        let exact = sentence_of("Palavra", 240);
        assert_eq!(exact.chars().count(), 240);
        assert_eq!(summary(&exact).as_deref(), Some(exact.as_str()));

        // 241 caracteres com espaço logo depois do 240º: corta ali, sem perder palavra
        let s = format!("{} {}", "B".repeat(240), "c".repeat(30));
        assert_eq!(summary(&s), Some(format!("{}…", "B".repeat(240))));

        // uma palavra só, mais longa que o limite: corte seco
        let s = "Z".repeat(300);
        let got = summary(&s).unwrap();
        assert_eq!(got.chars().count(), 241);
        assert!(got.ends_with('…'));
    }

    fn media(
        description: Option<&str>,
        city: Option<&str>,
        state: Option<&str>,
        country: Option<&str>,
    ) -> Media {
        Media {
            id: "aaaaaaaaaaaaaaaaaaaaaaaa".into(),
            source: "yanlucas".into(),
            version: "V1".into(),
            description: description.map(String::from),
            city: city.map(String::from),
            state: state.map(String::from),
            country: country.map(String::from),
            taken_at: None,
            color: "#000000".into(),
            variants: Vec::new(),
            focus: crate::model::Point::CENTER,
            crops: Default::default(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    /// Busca de traduções a partir de uma tabela fixa.
    fn dict<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<&'a str> {
        |source| pairs.iter().find(|(s, _)| *s == source).map(|(_, t)| *t)
    }

    const SUNSET_PT: &str = "Duna do Pôr do Sol: Esta formação natural faz parte do sistema \
        dinâmico de dunas da costa nordeste do Brasil. Moldada constantemente pelo vento…";

    #[test]
    fn info_with_translated_description_has_translated_title_and_text() {
        let m = media(Some(SUNSET), Some("Jericoacoara"), None, Some("Brazil"));
        let info = Info::localized(&m, dict(&[(SUNSET, SUNSET_PT), ("Brazil", "Brasil")]));
        assert_eq!(
            info,
            Info {
                place: Some("Jericoacoara, Brasil".into()),
                title: Some("Duna do Pôr do Sol".into()),
                text: Some(
                    "Esta formação natural faz parte do sistema dinâmico de dunas da costa \
                     nordeste do Brasil."
                        .into()
                ),
            }
        );

        // tradução sem título: o resumo sai da tradução inteira, mesmo com título no inglês
        let info = Info::localized(
            &m,
            dict(&[(SUNSET, "esta formação natural é parte do litoral. Mais.")]),
        );
        assert_eq!(info.title, None);
        assert_eq!(
            info.text.as_deref(),
            Some("Esta formação natural é parte do litoral.")
        );
    }

    #[test]
    fn info_with_partial_translation_falls_back_to_english_per_part() {
        let m = media(Some(FORMIGA), Some("Osaka"), Some("Osaka"), Some("Japan"));
        let info = Info::localized(&m, dict(&[("Japan", "Japão")]));
        assert_eq!(info.place.as_deref(), Some("Osaka, Japão"));
        // a descrição sem tradução fica em inglês
        assert_eq!(info.title, None);
        assert!(
            info.text
                .unwrap()
                .starts_with("Formiga Waterfall is a hidden gem")
        );

        // só a descrição traduzida: o local fica em inglês
        let m = media(
            Some(SUNSET),
            Some("Jericoacoara"),
            Some("Ceará"),
            Some("Brazil"),
        );
        let info = Info::localized(&m, dict(&[(SUNSET, SUNSET_PT)]));
        assert_eq!(info.place.as_deref(), Some("Jericoacoara, Ceará, Brazil"));
        assert_eq!(info.title.as_deref(), Some("Duna do Pôr do Sol"));

        // nada traduzido: igual ao inglês
        assert_eq!(Info::localized(&m, dict(&[])), Info::of(&m));
    }

    #[test]
    fn info_translated_part_equal_to_the_previous_one_is_not_repeated() {
        // textos diferentes na origem que viram o mesmo na tradução
        let m = media(None, Some("Osaka"), Some("Osaka Prefecture"), Some("Japan"));
        let info = Info::localized(
            &m,
            dict(&[("Osaka Prefecture", "Osaka"), ("Japan", "Japão")]),
        );
        assert_eq!(info.place.as_deref(), Some("Osaka, Japão"));

        // a regra vale sem diferenciar maiúsculas, sobre o texto traduzido
        let m = media(
            None,
            Some("New York"),
            Some("New York State"),
            Some("United States"),
        );
        let info = Info::localized(
            &m,
            dict(&[
                ("New York", "Nova York"),
                ("New York State", "nova york"),
                ("United States", "Estados Unidos"),
            ]),
        );
        assert_eq!(info.place.as_deref(), Some("Nova York, Estados Unidos"));

        // iguais no inglês, a tradução vale para as duas e continua sem repetir
        let m = media(None, Some("São Paulo"), Some("São Paulo"), Some("Brazil"));
        let info = Info::localized(&m, dict(&[("Brazil", "Brasil")]));
        assert_eq!(info.place.as_deref(), Some("São Paulo, Brasil"));
    }

    #[test]
    fn info_lookup_uses_the_text_without_surrounding_spaces() {
        let m = media(
            Some("  Morretes: A charming town. "),
            None,
            None,
            Some(" Japan "),
        );
        let info = Info::localized(
            &m,
            dict(&[
                (
                    "Morretes: A charming town.",
                    "Morretes: Uma cidade charmosa.",
                ),
                ("Japan", "Japão"),
            ]),
        );
        assert_eq!(info.place.as_deref(), Some("Japão"));
        assert_eq!(info.text.as_deref(), Some("Uma cidade charmosa."));
    }

    #[test]
    fn info_of_a_photo() {
        let m = media(
            Some(SUNSET),
            Some("Jericoacoara"),
            Some("Ceará"),
            Some("Brazil"),
        );
        assert_eq!(
            Info::of(&m),
            Info {
                place: Some("Jericoacoara, Ceará, Brazil".into()),
                title: Some("Sunset Dune".into()),
                text: Some(
                    "This natural formation is part of the dynamic dune system along the \
                     northeastern coast of Brazil."
                        .into()
                ),
            }
        );

        // sem título: o resumo vem da descrição inteira
        let m = media(Some(FORMIGA), None, None, Some("Brazil"));
        let info = Info::of(&m);
        assert_eq!(info.title, None);
        assert_eq!(
            info.text.as_deref(),
            Some(
                "Formiga Waterfall is a hidden gem located in the Jalapão region, near \
                 Mateiros, Tocantins."
            )
        );
        assert_eq!(info.place.as_deref(), Some("Brazil"));

        // sem descrição nem local
        assert_eq!(Info::of(&media(None, None, None, None)), Info::default());

        // só o título
        let info = Info::of(&media(Some("Morretes: "), None, None, None));
        assert_eq!((info.title.as_deref(), info.text), (Some("Morretes"), None));
    }
}
