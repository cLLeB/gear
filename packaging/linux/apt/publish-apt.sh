#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=${1:-/var/www/gear/apt}
DIST=${2:-stable}
COMPONENT=${3:-main}
ARCH=${4:-amd64}

mkdir -p "$REPO_DIR/dists/$DIST/$COMPONENT/binary-$ARCH"

# Copy .deb files into pool/ (adjust source path as needed)
mkdir -p "$REPO_DIR/pool"

# Example: cp ~/Downloads/*.deb "$REPO_DIR/pool/"

pushd "$REPO_DIR" > /dev/null

dpkg-scanpackages --arch "$ARCH" pool > "dists/$DIST/$COMPONENT/binary-$ARCH/Packages"
gzip -k -f "dists/$DIST/$COMPONENT/binary-$ARCH/Packages"

cat > "dists/$DIST/Release" <<EOF
Origin: Gear
Label: Gear
Suite: $DIST
Codename: $DIST
Architectures: $ARCH
Components: $COMPONENT
Description: Gear APT repository
EOF

apt-ftparchive release "dists/$DIST" >> "dists/$DIST/Release"

popd > /dev/null

echo "APT repo metadata generated in $REPO_DIR"
