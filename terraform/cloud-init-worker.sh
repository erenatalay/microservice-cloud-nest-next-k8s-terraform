#!/bin/bash


set -e


apt-get update
apt-get upgrade -y
apt-get install -y curl wget


swapoff -a
sed -i '/swap/d' /etc/fstab


echo "Waiting for master node..."
sleep 90


echo "Waiting for private network interface..."
for i in {1..30}; do
  if ip addr show | grep -q "${node_ip}"; then
    echo "Private network is ready"
    break
  fi
  sleep 2
done


export K3S_TOKEN="${k3s_token}"
export K3S_URL="https://${master_ip}:6443"


PRIVATE_IFACE=$(ip -o addr show | grep "${node_ip}" | awk '{print $2}')
echo "Using network interface: $PRIVATE_IFACE"

curl -sfL https://get.k3s.io | sh -s - agent \
  --node-name="worker-${node_ip}" \
  --node-ip="${node_ip}" \
  --flannel-iface=$PRIVATE_IFACE

echo "k3s worker kuruldu"
