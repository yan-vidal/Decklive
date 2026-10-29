//! Escolha do arquivo mais leve que fica nítido (design D7).

use crate::bucket::Bucket;
use crate::model::{Rect, Variant};

/// Fração mínima dos pixels da tela que o corte precisa ter, por eixo.
pub const SHARPNESS: f64 = 0.9;

/// O primeiro arquivo (do menor para o maior) em que o corte tem ≥ 90 % da tela
/// na largura e na altura; se nenhum alcançar, o maior.
/// `variants` não pode ser vazia (o catálogo garante pelo menos o original).
pub fn choose<'a>(variants: &'a [Variant], crop: &Rect, screen: Bucket) -> &'a Variant {
    // Folga mínima para o arredondamento do corte não reprovar um caso exato.
    const EPS: f64 = 1e-6;
    let need_w = SHARPNESS * f64::from(screen.w);
    let need_h = SHARPNESS * f64::from(screen.h);
    variants
        .iter()
        .find(|v| {
            crop.w * f64::from(v.width) + EPS >= need_w
                && crop.h * f64::from(v.height) + EPS >= need_h
        })
        .or_else(|| variants.last())
        .expect("toda foto do catálogo tem pelo menos um arquivo")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crop;
    use crate::model::{Crops, Point, VariantKind};

    fn v(kind: VariantKind, width: u32, height: u32) -> Variant {
        Variant {
            kind,
            url: format!("https://cdn.yanlucas.com/{kind:?}.jpeg"),
            width,
            height,
        }
    }

    const TV: Bucket = Bucket { w: 1920, h: 1080 };

    fn pick(variants: &[Variant], screen: Bucket) -> VariantKind {
        let full = variants.last().unwrap();
        let c = crop::compute(
            full.width,
            full.height,
            screen,
            Point::CENTER,
            &Crops::default(),
        );
        choose(variants, &c, screen).kind
    }

    #[test]
    fn variant_optimized_is_enough() {
        // spec: otimizado 2000×1333, original 6000×4000, tela 1920×1080
        let variants = [
            v(VariantKind::Thumbnail, 200, 133),
            v(VariantKind::Optimized, 2000, 1333),
            v(VariantKind::Full, 6000, 4000),
        ];
        assert_eq!(pick(&variants, TV), VariantKind::Optimized);
    }

    #[test]
    fn variant_full_hd_tv_needs_original() {
        // spec: otimizado 981×613, original 2944×1839, tela 1920×1080
        let variants = [
            v(VariantKind::Thumbnail, 196, 123),
            v(VariantKind::Optimized, 981, 613),
            v(VariantKind::Full, 2944, 1839),
        ];
        assert_eq!(pick(&variants, TV), VariantKind::Full);
    }

    #[test]
    fn variant_none_reaches_so_the_largest_is_used() {
        let variants = [
            v(VariantKind::Thumbnail, 196, 123),
            v(VariantKind::Optimized, 981, 613),
            v(VariantKind::Full, 2944, 1839),
        ];
        assert_eq!(
            pick(&variants, Bucket { w: 3840, h: 2160 }),
            VariantKind::Full
        );
    }

    #[test]
    fn variant_thumbnail_can_serve_tiny_crops_only_when_sharp() {
        let variants = [
            v(VariantKind::Thumbnail, 1500, 1000),
            v(VariantKind::Optimized, 3000, 2000),
            v(VariantKind::Full, 6000, 4000),
        ];
        let screen = Bucket { w: 1280, h: 720 };
        assert_eq!(pick(&variants, screen), VariantKind::Thumbnail);
        // uma região pequena pede mais pixels: o otimizado já não basta
        let crops = Crops {
            landscape: Some(Rect {
                x: 0.4,
                y: 0.4,
                w: 0.2,
                h: 0.2,
            }),
            portrait: None,
        };
        let c = crop::compute(6000, 4000, screen, Point::CENTER, &crops);
        assert_eq!(choose(&variants, &c, screen).kind, VariantKind::Full);
    }

    #[test]
    fn variant_threshold_is_ninety_percent_on_each_axis() {
        let full = Rect {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
        };
        let screen = Bucket { w: 1000, h: 1000 };
        let exact = [
            v(VariantKind::Optimized, 900, 900),
            v(VariantKind::Full, 2000, 2000),
        ];
        assert_eq!(choose(&exact, &full, screen).kind, VariantKind::Optimized);
        let short = [
            v(VariantKind::Optimized, 900, 899),
            v(VariantKind::Full, 2000, 2000),
        ];
        assert_eq!(choose(&short, &full, screen).kind, VariantKind::Full);
    }
}
