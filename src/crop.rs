//! Corte da foto para a proporção da tela (design D7).

use crate::bucket::{Bucket, Orientation};
use crate::model::{Crops, Point, Rect};

/// Precisão do corte na resposta: milionésimos da foto.
const SCALE: f64 = 1_000_000.0;

/// Corte normalizado (0..1) da foto `iw×ih` para a tela `screen`.
///
/// Com região da orientação da tela: o menor corte que a contém, centrado nela.
/// Sem região: o maior corte, centrado no ponto de interesse. Sempre dentro da foto.
pub fn compute(iw: u32, ih: u32, screen: Bucket, focus: Point, crops: &Crops) -> Rect {
    let (iw, ih) = (f64::from(iw.max(1)), f64::from(ih.max(1)));
    let a = screen.aspect();

    // Corte máximo na proporção da tela.
    let (max_w, max_h) = if iw / ih > a {
        (ih * a, ih)
    } else {
        (iw, iw / a)
    };

    // Tela quadrada usa a região de landscape.
    let (own, other) = match screen.orientation() {
        Orientation::Portrait => (crops.portrait, crops.landscape),
        Orientation::Landscape | Orientation::Square => (crops.landscape, crops.portrait),
    };

    let (cw, ch, center) = match own {
        Some(r) => {
            let cw = (r.w * iw).max(r.h * ih * a);
            let (cw, ch) = if cw >= max_w {
                (max_w, max_h)
            } else {
                (cw, cw / a)
            };
            (cw, ch, r.center())
        }
        None => {
            let point = other.map(|r| r.center()).unwrap_or(focus);
            (max_w, max_h, point)
        }
    };

    // Centra no ponto e desloca para dentro da foto.
    let x = (center.x * iw - cw / 2.0).clamp(0.0, iw - cw);
    let y = (center.y * ih - ch / 2.0).clamp(0.0, ih - ch);

    // Normaliza em milionésimos, sem deixar o arredondamento sair da foto.
    let w = (cw / iw * SCALE).round().clamp(1.0, SCALE);
    let h = (ch / ih * SCALE).round().clamp(1.0, SCALE);
    let x = (x / iw * SCALE).round().clamp(0.0, SCALE - w);
    let y = (y / ih * SCALE).round().clamp(0.0, SCALE - h);
    Rect {
        x: x / SCALE,
        y: y / SCALE,
        w: w / SCALE,
        h: h / SCALE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bucket::LONG_SIDES;

    const LANDSCAPE: Bucket = Bucket { w: 1920, h: 1080 };
    const PORTRAIT: Bucket = Bucket { w: 1182, h: 2560 };
    const SQUARE: Bucket = Bucket { w: 1920, h: 1920 };

    fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect { x, y, w, h }
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 2e-6
    }

    /// Proporção certa (erro < 0,5 %) e dentro da foto.
    fn assert_valid(c: &Rect, iw: u32, ih: u32, screen: Bucket) {
        let ratio = (c.w * f64::from(iw)) / (c.h * f64::from(ih));
        let err = (ratio / screen.aspect() - 1.0).abs();
        assert!(
            err < 0.005,
            "proporção {ratio} x {} ({err})",
            screen.aspect()
        );
        assert!(c.x >= 0.0 && c.y >= 0.0, "{c:?}");
        assert!(c.w > 0.0 && c.h > 0.0, "{c:?}");
        assert!(c.x + c.w <= 1.0 + 1e-9 && c.y + c.h <= 1.0 + 1e-9, "{c:?}");
    }

    fn contains(outer: &Rect, inner: &Rect) -> bool {
        outer.x <= inner.x + 1e-6
            && outer.y <= inner.y + 1e-6
            && outer.x + outer.w + 1e-6 >= inner.x + inner.w
            && outer.y + outer.h + 1e-6 >= inner.y + inner.h
    }

    #[test]
    fn crop_without_framing_is_largest_centered() {
        let c = compute(6000, 4000, LANDSCAPE, Point::CENTER, &Crops::default());
        assert_valid(&c, 6000, 4000, LANDSCAPE);
        assert!(close(c.w, 1.0) && close(c.h, 0.84375), "{c:?}");
        assert!(close(c.x, 0.0) && close(c.y, 0.078125), "{c:?}");
    }

    #[test]
    fn crop_focus_near_edge_touches_the_border() {
        let c = compute(
            6000,
            4000,
            PORTRAIT,
            Point { x: 0.95, y: 0.5 },
            &Crops::default(),
        );
        assert_valid(&c, 6000, 4000, PORTRAIT);
        assert!(close(c.h, 1.0), "maior corte possível: {c:?}");
        assert!(close(c.x + c.w, 1.0), "encosta na borda direita: {c:?}");
    }

    #[test]
    fn crop_portrait_region_is_contained_and_centered() {
        let region = rect(0.4, 0.1, 0.2, 0.5);
        let crops = Crops {
            landscape: None,
            portrait: Some(region),
        };
        let c = compute(6000, 4000, PORTRAIT, Point::CENTER, &crops);
        assert_valid(&c, 6000, 4000, PORTRAIT);
        assert!(contains(&c, &region), "{c:?}");
        assert!(close(c.center().x, region.center().x) && close(c.center().y, region.center().y));
        // o menor corte: a largura é a da região
        assert!(close(c.w, region.w), "{c:?}");
    }

    #[test]
    fn crop_region_near_edge_is_shifted_inside() {
        let region = rect(0.4, 0.0, 0.2, 0.3);
        let crops = Crops {
            landscape: None,
            portrait: Some(region),
        };
        let c = compute(6000, 4000, PORTRAIT, Point::CENTER, &crops);
        assert_valid(&c, 6000, 4000, PORTRAIT);
        assert!(contains(&c, &region), "{c:?}");
        assert!(close(c.y, 0.0), "{c:?}");
    }

    #[test]
    fn crop_region_wider_than_possible_uses_largest_centered_on_region() {
        let region = rect(0.3, 0.0, 0.4, 1.0);
        let crops = Crops {
            landscape: None,
            portrait: Some(region),
        };
        let c = compute(6000, 4000, PORTRAIT, Point { x: 0.1, y: 0.1 }, &crops);
        assert_valid(&c, 6000, 4000, PORTRAIT);
        assert!(close(c.h, 1.0), "maior corte: {c:?}");
        assert!(close(c.center().x, 0.5), "centrado na região: {c:?}");
    }

    #[test]
    fn crop_square_screen_uses_landscape_region() {
        let crops = Crops {
            landscape: Some(rect(0.0, 0.0, 0.3, 0.3)),
            portrait: Some(rect(0.7, 0.7, 0.3, 0.3)),
        };
        let c = compute(6000, 4000, SQUARE, Point::CENTER, &crops);
        assert_valid(&c, 6000, 4000, SQUARE);
        assert!(contains(&c, &crops.landscape.unwrap()), "{c:?}");
        assert!(!contains(&c, &crops.portrait.unwrap()), "{c:?}");
    }

    #[test]
    fn crop_only_other_orientation_region_acts_as_focus() {
        let region = rect(0.6, 0.2, 0.4, 0.4);
        let crops = Crops {
            landscape: Some(region),
            portrait: None,
        };
        let c = compute(6000, 4000, PORTRAIT, Point { x: 0.1, y: 0.1 }, &crops);
        assert_valid(&c, 6000, 4000, PORTRAIT);
        assert!(close(c.h, 1.0), "maior corte: {c:?}");
        assert!(
            close(c.center().x, 0.8),
            "centro da região de landscape: {c:?}"
        );
    }

    #[test]
    fn crop_landscape_screen_ignores_portrait_region_except_as_focus() {
        let region = rect(0.0, 0.6, 0.2, 0.4);
        let crops = Crops {
            landscape: None,
            portrait: Some(region),
        };
        // foto em pé numa tela deitada: o corte vai para baixo, onde está a região
        let c = compute(2000, 3000, LANDSCAPE, Point::CENTER, &crops);
        assert_valid(&c, 2000, 3000, LANDSCAPE);
        assert!(close(c.w, 1.0), "{c:?}");
        assert!(close(c.center().y, 0.8), "{c:?}");
    }

    #[test]
    fn crop_is_always_valid_for_every_bucket() {
        let photos = [
            (2944, 1839),
            (1839, 2944),
            (2000, 2000),
            (6000, 4000),
            (1000, 1100),
            (17, 9000),
        ];
        let focuses = [
            Point::CENTER,
            Point { x: 0.0, y: 1.0 },
            Point { x: 1.0, y: 0.0 },
        ];
        let regions = [
            None,
            Some(rect(0.0, 0.0, 1.0, 1.0)),
            Some(rect(0.9, 0.9, 0.1, 0.1)),
            Some(rect(0.123, 0.456, 0.001, 0.5)),
        ];
        let mut screens = Vec::new();
        for &l in &LONG_SIDES {
            for s in [
                l,
                l * 3 / 4,
                l * 10 / 16,
                l * 9 / 16,
                l * 18 / 39,
                l * 9 / 21,
            ] {
                screens.push(Bucket { w: l, h: s });
                screens.push(Bucket { w: s, h: l });
            }
        }
        for (iw, ih) in photos {
            for screen in &screens {
                for focus in focuses {
                    for region in regions {
                        let crops = Crops {
                            landscape: region,
                            portrait: region,
                        };
                        let c = compute(iw, ih, *screen, focus, &crops);
                        assert_valid(&c, iw, ih, *screen);
                        if let Some(r) = region {
                            let max = compute(iw, ih, *screen, focus, &Crops::default());
                            if c.w < max.w - 1e-6 {
                                assert!(contains(&c, &r), "{c:?} {r:?}");
                            }
                        }
                    }
                }
            }
        }
    }
}
