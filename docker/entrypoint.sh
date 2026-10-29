#!/bin/sh
# Começa como root só para entregar a pasta de dados ao usuário decklive: uma pasta
# montada do host (./data) costuma nascer como root. O serviço roda sem privilégios.
set -eu

uid=10001
gid=10001

if [ "$(id -u)" = 0 ]; then
    data_dir=$(dirname "${DECKLIVE_DATABASE:-/app/data/decklive.db}")
    mkdir -p "$data_dir"
    # só o que não é do usuário (pasta nova, backup restaurado como root...)
    find "$data_dir" \( ! -user "$uid" -o ! -group "$gid" \) -exec chown "$uid:$gid" {} +
    exec setpriv --reuid="$uid" --regid="$gid" --clear-groups -- "$@"
fi

# Já sem privilégios (por exemplo, com `user:` no compose): roda direto.
exec "$@"
