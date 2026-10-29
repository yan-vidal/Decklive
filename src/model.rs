//! Tipos do catálogo.

use serde::{Deserialize, Serialize};

/// Ponto relativo à foto (0..1).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const CENTER: Point = Point { x: 0.5, y: 0.5 };
}

/// Retângulo relativo à foto (0..1).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn center(&self) -> Point {
        Point {
            x: self.x + self.w / 2.0,
            y: self.y + self.h / 2.0,
        }
    }
}

/// Regiões de interesse por orientação da tela.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Crops {
    #[serde(default)]
    pub landscape: Option<Rect>,
    #[serde(default)]
    pub portrait: Option<Rect>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VariantKind {
    Thumbnail,
    Optimized,
    Full,
}

/// Um arquivo da foto no CDN.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Variant {
    pub kind: VariantKind,
    pub url: String,
    pub width: u32,
    pub height: u32,
}

/// Foto como fica gravada no catálogo.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Media {
    pub id: String,
    pub source: String,
    pub version: String,
    pub description: Option<String>,
    /// Local como vem da origem; sem coordenadas.
    pub city: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
    pub taken_at: Option<String>,
    pub color: String,
    /// Do menor para o maior.
    pub variants: Vec<Variant>,
    pub focus: Point,
    pub crops: Crops,
    pub created_at: String,
    pub updated_at: String,
}

impl Media {
    /// O maior arquivo; as contas de corte usam as dimensões dele.
    pub fn largest(&self) -> Option<&Variant> {
        self.variants.last()
    }
}

/// Dados de uma foto a gravar (o repositório completa datas e origem).
#[derive(Debug, Clone, PartialEq)]
pub struct NewMedia {
    pub id: String,
    pub version: String,
    pub description: Option<String>,
    pub taken_at: Option<String>,
    pub color: String,
    pub variants: Vec<Variant>,
    pub focus: Point,
    pub crops: Crops,
    pub city: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
}
