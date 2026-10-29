//! Etiquetas de idioma das traduções e da playlist (design D2 de
//! `add-localized-descriptions`).

/// Idioma dos textos da origem (yanlucas.com). Não tem traduções: é o texto como veio.
pub const SOURCE_LANG: &str = "en";

/// Por que uma etiqueta não serve para gravar traduções.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagError {
    /// Fora de `^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$`.
    Format,
    /// Inglês, o idioma da origem.
    Source,
}

/// Valida e normaliza a etiqueta: língua em minúsculas, região de 2 letras em
/// maiúsculas, script de 4 letras com a primeira maiúscula e o resto em minúsculas
/// (`pt-br` → `pt-BR`, `zh-hant-tw` → `zh-Hant-TW`). Formato inválido dá `None`.
pub fn normalize(tag: &str) -> Option<String> {
    let mut parts = tag.split('-');
    let primary = parts.next()?;
    if !(2..=3).contains(&primary.len()) || !primary.bytes().all(|b| b.is_ascii_alphabetic()) {
        return None;
    }
    let mut out = primary.to_ascii_lowercase();
    for (i, sub) in parts.enumerate() {
        let valid =
            i < 2 && (2..=8).contains(&sub.len()) && sub.bytes().all(|b| b.is_ascii_alphanumeric());
        if !valid {
            return None;
        }
        out.push('-');
        let alpha = sub.bytes().all(|b| b.is_ascii_alphabetic());
        match sub.len() {
            // região
            2 if alpha => out.push_str(&sub.to_ascii_uppercase()),
            // script
            4 if alpha => {
                out.push_str(&sub[..1].to_ascii_uppercase());
                out.push_str(&sub[1..].to_ascii_lowercase());
            }
            // região numérica ("419") e variantes
            _ => out.push_str(&sub.to_ascii_lowercase()),
        }
    }
    Some(out)
}

/// Etiqueta para gravar, listar ou remover traduções: normalizada e diferente do
/// inglês da origem (`en` e suas variantes, como `en-US`).
pub fn for_translations(tag: &str) -> Result<String, TagError> {
    let tag = normalize(tag).ok_or(TagError::Format)?;
    if is_source(&tag) {
        return Err(TagError::Source);
    }
    Ok(tag)
}

/// Se a etiqueta (já válida) é da língua da origem.
pub fn is_source(tag: &str) -> bool {
    primary(tag).eq_ignore_ascii_case(SOURCE_LANG)
}

/// Subetiqueta primária: a língua, sem região nem script.
fn primary(tag: &str) -> &str {
    tag.split('-').next().unwrap_or(tag)
}

/// Idioma canônico de um pedido, entre os que têm ao menos uma tradução:
/// 1. a etiqueta igual, sem diferenciar maiúsculas;
/// 2. senão, a mesma língua: o primeiro disponível, em ordem alfabética;
/// 3. senão, `None`, que é o inglês da origem (a URL sem `lang`).
pub fn choose<'a>(requested: &str, available: &'a [String]) -> Option<&'a str> {
    // o inglês é a origem, mesmo que alguém tenha gravado uma variante à mão no banco
    if is_source(requested) {
        return None;
    }
    if let Some(same) = available
        .iter()
        .find(|tag| tag.eq_ignore_ascii_case(requested))
    {
        return Some(same);
    }
    let language = primary(requested);
    available
        .iter()
        .filter(|tag| primary(tag).eq_ignore_ascii_case(language))
        .min()
        .map(String::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lang_tag_is_validated_and_normalized() {
        let cases: &[(&str, &str)] = &[
            ("pt-br", "pt-BR"),
            ("PT-BR", "pt-BR"),
            ("pt-BR", "pt-BR"),
            ("pt", "pt"),
            ("ES", "es"),
            ("fil", "fil"),
            ("zh-hant-tw", "zh-Hant-TW"),
            ("ZH-HANT", "zh-Hant"),
            ("sr-latn", "sr-Latn"),
            // região numérica e variantes ficam como vêm, em minúsculas
            ("es-419", "es-419"),
            ("de-CH-1996", "de-CH-1996"),
            ("sl-ROZAJ", "sl-rozaj"),
            ("en", "en"),
            ("en-us", "en-US"),
        ];
        for &(tag, expected) in cases {
            assert_eq!(normalize(tag).as_deref(), Some(expected), "{tag:?}");
        }
        for bad in [
            "",
            "p",
            "ptbr",
            "portuguese",
            "pt_BR",
            "pt-",
            "-pt",
            "pt--BR",
            "pt-B",
            "pt-BR-Latn-x",
            "pt-toolongxx",
            "pt BR",
            " pt",
            "pt-BR ",
            "1a",
            "pt-é",
            "pt-BR%20",
            "*",
        ] {
            assert_eq!(normalize(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn lang_source_is_refused_for_translations() {
        assert_eq!(for_translations("pt-br"), Ok("pt-BR".into()));
        assert_eq!(for_translations("es"), Ok("es".into()));
        for source in ["en", "EN", "en-US", "en-gb"] {
            assert_eq!(for_translations(source), Err(TagError::Source), "{source}");
        }
        assert_eq!(for_translations("pt_BR"), Err(TagError::Format));
        assert_eq!(for_translations(""), Err(TagError::Format));
        // "eng" não é "en": a regra olha a língua inteira
        assert_eq!(for_translations("eng"), Ok("eng".into()));
        assert!(is_source("en") && is_source("EN-us"));
        assert!(!is_source("eng") && !is_source("es"));
    }

    #[test]
    fn lang_canonical_choice() {
        let available =
            |tags: &[&str]| -> Vec<String> { tags.iter().map(|t| t.to_string()).collect() };
        type Case<'a> = (&'a [&'a str], &'a str, Option<&'a str>);
        let cases: &[Case] = &[
            // etiqueta igual, sem diferenciar maiúsculas
            (&["es", "pt-BR"], "pt-BR", Some("pt-BR")),
            (&["es", "pt-BR"], "pt-br", Some("pt-BR")),
            (&["es", "pt-BR"], "es", Some("es")),
            // mesma língua, outra região (ou sem região)
            (&["es", "pt-BR"], "pt-PT", Some("pt-BR")),
            (&["es", "pt-BR"], "pt", Some("pt-BR")),
            (&["es", "pt-BR"], "es-MX", Some("es")),
            (&["pt-BR"], "PT-ao", Some("pt-BR")),
            // a igual vence a mesma língua
            (&["pt", "pt-BR", "pt-PT"], "pt-PT", Some("pt-PT")),
            // mesma língua: a primeira em ordem alfabética, em qualquer ordem de entrada
            (&["pt-PT", "pt-BR"], "pt-AO", Some("pt-BR")),
            (&["pt-PT", "pt-BR", "pt"], "pt-AO", Some("pt")),
            (&["zh-Hant", "zh-Hans"], "zh-Hant", Some("zh-Hant")),
            (&["zh-Hant", "zh-Hans"], "zh-TW", Some("zh-Hans")),
            // sem tradução: inglês
            (&["es", "pt-BR"], "fr", None),
            (&[], "pt-BR", None),
            // a subetiqueta primária é comparada inteira
            (&["pt-BR"], "ptx", None),
            // inglês pedido: sempre a origem
            (&["es", "pt-BR"], "en", None),
            (&["es", "pt-BR"], "en-US", None),
        ];
        for &(tags, requested, expected) in cases {
            let tags = available(tags);
            assert_eq!(
                choose(requested, &tags),
                expected,
                "{requested:?} entre {tags:?}"
            );
        }
    }
}
