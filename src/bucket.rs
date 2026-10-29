//! Faixas canônicas de tela e orientação de fotos (design D6).

use serde::Serialize;

/// Classes de proporção `p:q` (lado longo : lado curto).
pub const RATIO_CLASSES: [(u32, u32); 6] = [(1, 1), (4, 3), (16, 10), (16, 9), (39, 18), (21, 9)];

/// Lados longos aceitos, do menor para o maior.
pub const LONG_SIDES: [u32; 4] = [1280, 1920, 2560, 3840];

/// Limite aceito em `w` e `h`.
pub const MAX_SIDE: u32 = 16384;

/// Tela canônica, em pixels físicos.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Bucket {
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Orientation {
    Landscape,
    Portrait,
    Square,
}

impl Bucket {
    pub fn orientation(&self) -> Orientation {
        use std::cmp::Ordering::*;
        match self.w.cmp(&self.h) {
            Greater => Orientation::Landscape,
            Less => Orientation::Portrait,
            Equal => Orientation::Square,
        }
    }

    pub fn aspect(&self) -> f64 {
        f64::from(self.w) / f64::from(self.h)
    }
}

/// Classe de proporção mais próxima em `|ln(r) − ln(c)|`.
pub fn ratio_class(long: u32, short: u32) -> (u32, u32) {
    let r = (f64::from(long) / f64::from(short)).ln();
    let distance = |&(p, q): &(u32, u32)| (r - (f64::from(p) / f64::from(q)).ln()).abs();
    *RATIO_CLASSES
        .iter()
        .min_by(|a, b| distance(a).total_cmp(&distance(b)))
        .expect("lista de classes não é vazia")
}

/// Faixa canônica de uma tela `w×h` (ambos ≥ 1).
pub fn canonical(w: u32, h: u32) -> Bucket {
    let (w, h) = (w.max(1), h.max(1));
    let (long, short) = (w.max(h), w.min(h));
    let (p, q) = ratio_class(long, short);
    let l = LONG_SIDES
        .iter()
        .copied()
        .find(|&s| s >= long)
        .unwrap_or(LONG_SIDES[LONG_SIDES.len() - 1]);
    if p == q {
        return Bucket { w: l, h: l };
    }
    // round(l·q/p) com meio para cima, em inteiros
    let s = (2 * l * q + p) / (2 * p);
    if h > w {
        Bucket { w: s, h: l }
    } else {
        Bucket { w: l, h: s }
    }
}

/// Orientação de uma foto: `square` na classe 1:1.
pub fn orientation(w: u32, h: u32) -> Orientation {
    let (w, h) = (w.max(1), h.max(1));
    let (p, q) = ratio_class(w.max(h), w.min(h));
    if p == q {
        Orientation::Square
    } else if w > h {
        Orientation::Landscape
    } else {
        Orientation::Portrait
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    const FIXTURE: &str = include_str!("../fixtures/screen-buckets.json");

    #[derive(Deserialize)]
    struct Fixture {
        ratio_classes: Vec<(u32, u32)>,
        long_sides: Vec<u32>,
        screens: Vec<ScreenCase>,
        photos: Vec<PhotoCase>,
    }

    #[derive(Deserialize)]
    struct Size {
        w: u32,
        h: u32,
    }

    #[derive(Deserialize)]
    struct ScreenCase {
        w: u32,
        h: u32,
        canonical: Size,
    }

    #[derive(Deserialize)]
    struct PhotoCase {
        w: u32,
        h: u32,
        orientation: Orientation,
    }

    impl<'de> Deserialize<'de> for Orientation {
        fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
            match String::deserialize(d)?.as_str() {
                "landscape" => Ok(Orientation::Landscape),
                "portrait" => Ok(Orientation::Portrait),
                "square" => Ok(Orientation::Square),
                other => Err(serde::de::Error::custom(format!("orientação {other}"))),
            }
        }
    }

    fn fixture() -> Fixture {
        serde_json::from_str(FIXTURE).unwrap()
    }

    #[test]
    fn bucket_constants_match_fixture() {
        let f = fixture();
        assert_eq!(f.ratio_classes, RATIO_CLASSES);
        assert_eq!(f.long_sides, LONG_SIDES);
    }

    #[test]
    fn bucket_screens_from_fixture() {
        let f = fixture();
        assert!(f.screens.len() >= 12);
        for case in &f.screens {
            let got = canonical(case.w, case.h);
            assert_eq!(
                (got.w, got.h),
                (case.canonical.w, case.canonical.h),
                "tela {}x{}",
                case.w,
                case.h
            );
        }
    }

    #[test]
    fn bucket_spec_examples() {
        assert_eq!(canonical(1920, 1080), Bucket { w: 1920, h: 1080 });
        assert_eq!(canonical(1170, 2532), Bucket { w: 1182, h: 2560 });
        assert_eq!(canonical(5120, 2880), Bucket { w: 3840, h: 2160 });
    }

    #[test]
    fn bucket_canonical_is_a_fixed_point() {
        let f = fixture();
        for case in &f.screens {
            let b = canonical(case.w, case.h);
            assert_eq!(canonical(b.w, b.h), b, "faixa {}x{}", b.w, b.h);
        }
    }

    /// Todas as faixas possíveis: redirecionar para elas nunca entra em laço.
    pub(crate) fn all_buckets() -> Vec<Bucket> {
        let mut all = Vec::new();
        for &l in &LONG_SIDES {
            for &(p, q) in &RATIO_CLASSES {
                let s = (2 * l * q + p) / (2 * p);
                for b in [Bucket { w: l, h: s }, Bucket { w: s, h: l }] {
                    if !all.contains(&b) {
                        all.push(b);
                    }
                }
            }
        }
        all
    }

    #[test]
    fn bucket_every_canonical_bucket_is_a_fixed_point() {
        let all = all_buckets();
        assert_eq!(all.len(), 44);
        for b in all {
            assert_eq!(canonical(b.w, b.h), b);
        }
    }

    #[test]
    fn bucket_photo_orientation_from_fixture() {
        for case in fixture().photos {
            assert_eq!(
                orientation(case.w, case.h),
                case.orientation,
                "foto {}x{}",
                case.w,
                case.h
            );
        }
    }

    #[test]
    fn bucket_screen_orientation() {
        assert_eq!(
            Bucket { w: 1920, h: 1080 }.orientation(),
            Orientation::Landscape
        );
        assert_eq!(
            Bucket { w: 1182, h: 2560 }.orientation(),
            Orientation::Portrait
        );
        assert_eq!(
            Bucket { w: 1920, h: 1920 }.orientation(),
            Orientation::Square
        );
    }
}
