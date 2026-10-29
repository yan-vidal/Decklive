//! Validação do pedido de registro: id, ponto e regiões de interesse.

use crate::error::ApiError;
use crate::model::{Crops, Point, Rect};

/// Folga para somas como 0.3 + 0.7 em ponto flutuante.
const EPS: f64 = 1e-9;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invalid {
    pub field: String,
    pub message: String,
}

impl Invalid {
    fn new(field: impl Into<String>, message: impl Into<String>) -> Self {
        Invalid {
            field: field.into(),
            message: message.into(),
        }
    }
}

impl From<Invalid> for ApiError {
    fn from(i: Invalid) -> Self {
        ApiError::invalid(i.field, i.message)
    }
}

/// Id do yanlucas.com: 24 caracteres hexadecimais, guardado em minúsculas.
pub fn normalize_id(id: &str) -> Result<String, Invalid> {
    let id = id.trim();
    if id.len() == 24 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(id.to_ascii_lowercase())
    } else {
        Err(Invalid::new(
            "id",
            "o id precisa ter 24 caracteres hexadecimais (o _id do yanlucas.com)",
        ))
    }
}

/// Sem ponto informado, o centro da foto.
pub fn validate_focus(focus: Option<Point>) -> Result<Point, Invalid> {
    let Some(p) = focus else {
        return Ok(Point::CENTER);
    };
    unit("focus.x", p.x)?;
    unit("focus.y", p.y)?;
    Ok(p)
}

pub fn validate_crops(crops: Option<Crops>) -> Result<Crops, Invalid> {
    let crops = crops.unwrap_or_default();
    if let Some(r) = &crops.landscape {
        validate_rect("crops.landscape", r)?;
    }
    if let Some(r) = &crops.portrait {
        validate_rect("crops.portrait", r)?;
    }
    Ok(crops)
}

fn validate_rect(name: &str, r: &Rect) -> Result<(), Invalid> {
    unit(&format!("{name}.x"), r.x)?;
    unit(&format!("{name}.y"), r.y)?;
    for (axis, size, start, start_name) in [("w", r.w, r.x, "x"), ("h", r.h, r.y, "y")] {
        let field = format!("{name}.{axis}");
        if !size.is_finite() || size <= 0.0 {
            return Err(Invalid::new(
                field,
                format!("{axis} precisa ser maior que 0"),
            ));
        }
        if start + size > 1.0 + EPS {
            return Err(Invalid::new(
                field,
                format!(
                    "{start_name} + {axis} = {} passa de 1: a região sai da foto",
                    start + size
                ),
            ));
        }
    }
    Ok(())
}

/// Número finito entre 0 e 1.
fn unit(field: &str, v: f64) -> Result<(), Invalid> {
    if v.is_finite() && (0.0..=1.0).contains(&v) {
        Ok(())
    } else {
        Err(Invalid::new(field, "precisa estar entre 0 e 1"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect { x, y, w, h }
    }

    fn portrait(r: Rect) -> Option<Crops> {
        Some(Crops {
            landscape: None,
            portrait: Some(r),
        })
    }

    fn field_of<T: std::fmt::Debug>(r: Result<T, Invalid>) -> String {
        r.unwrap_err().field
    }

    #[test]
    fn id_must_be_24_hex() {
        assert_eq!(
            normalize_id("66d312a4124fa13304b01ea7").unwrap(),
            "66d312a4124fa13304b01ea7"
        );
        assert_eq!(
            normalize_id(" 66D312A4124FA13304B01EA7 ").unwrap(),
            "66d312a4124fa13304b01ea7"
        );
        for bad in [
            "",
            "66d312a4",
            "66d312a4124fa13304b01ea7a",
            "66d312a4124fa13304b01eaz",
        ] {
            assert_eq!(field_of(normalize_id(bad)), "id", "{bad:?}");
        }
    }

    #[test]
    fn focus_defaults_to_center_and_stays_in_range() {
        assert_eq!(validate_focus(None).unwrap(), Point::CENTER);
        assert_eq!(
            validate_focus(Some(Point { x: 0.0, y: 1.0 })).unwrap(),
            Point { x: 0.0, y: 1.0 }
        );
        assert_eq!(
            field_of(validate_focus(Some(Point { x: 1.01, y: 0.5 }))),
            "focus.x"
        );
        assert_eq!(
            field_of(validate_focus(Some(Point { x: 0.5, y: -0.1 }))),
            "focus.y"
        );
        assert_eq!(
            field_of(validate_focus(Some(Point {
                x: f64::NAN,
                y: 0.5
            }))),
            "focus.x"
        );
    }

    #[test]
    fn crops_are_optional_and_valid_ones_pass() {
        assert_eq!(validate_crops(None).unwrap(), Crops::default());
        let ok = portrait(rect(0.3, 0.0, 0.4, 1.0));
        assert_eq!(validate_crops(ok).unwrap(), ok.unwrap());
        // soma com erro de ponto flutuante ainda cabe
        assert!(validate_crops(portrait(rect(0.3, 0.1, 0.7, 0.9))).is_ok());
        let full = Some(Crops {
            landscape: Some(rect(0.0, 0.0, 1.0, 1.0)),
            portrait: None,
        });
        assert!(validate_crops(full).is_ok());
    }

    #[test]
    fn crops_outside_the_photo_are_rejected() {
        assert_eq!(
            field_of(validate_crops(portrait(rect(0.7, 0.0, 0.4, 1.0)))),
            "crops.portrait.w"
        );
        assert_eq!(
            field_of(validate_crops(portrait(rect(0.0, 0.5, 0.5, 0.6)))),
            "crops.portrait.h"
        );
        assert_eq!(
            field_of(validate_crops(portrait(rect(-0.1, 0.0, 0.5, 0.5)))),
            "crops.portrait.x"
        );
        assert_eq!(
            field_of(validate_crops(portrait(rect(0.0, 1.5, 0.5, 0.5)))),
            "crops.portrait.y"
        );
        let landscape = Some(Crops {
            landscape: Some(rect(0.0, 0.0, 1.2, 0.5)),
            portrait: None,
        });
        assert_eq!(field_of(validate_crops(landscape)), "crops.landscape.w");
    }

    #[test]
    fn crops_with_zero_size_are_rejected() {
        assert_eq!(
            field_of(validate_crops(portrait(rect(0.1, 0.1, 0.0, 0.5)))),
            "crops.portrait.w"
        );
        assert_eq!(
            field_of(validate_crops(portrait(rect(0.1, 0.1, 0.5, 0.0)))),
            "crops.portrait.h"
        );
        assert_eq!(
            field_of(validate_crops(portrait(rect(0.1, 0.1, 0.5, -0.2)))),
            "crops.portrait.h"
        );
    }
}
