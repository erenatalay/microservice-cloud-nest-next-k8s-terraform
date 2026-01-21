




locals {
  namespace = var.environment
}





resource "kubernetes_namespace" "main" {
  metadata {
    name = local.namespace
    labels = {
      name        = local.namespace
      environment = var.environment
      managed_by  = "terraform"
    }
  }
}





resource "kubernetes_secret" "docker_registry" {
  for_each = { for s in var.image_pull_secrets : s.name => s }

  metadata {
    name      = each.value.name
    namespace = kubernetes_namespace.main.metadata[0].name
  }

  type = "kubernetes.io/dockerconfigjson"

  data = {
    ".dockerconfigjson" = jsonencode({
      auths = {
        "${each.value.registry}" = {
          username = each.value.username
          password = each.value.password
          auth     = base64encode("${each.value.username}:${each.value.password}")
        }
      }
    })
  }
}







resource "helm_release" "cert_manager" {
  count = var.enable_cert_manager ? 1 : 0

  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = "1.14.0"
  namespace        = "cert-manager"
  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }

  set {
    name  = "prometheus.enabled"
    value = var.enable_monitoring
  }
}


resource "kubernetes_manifest" "letsencrypt_issuer" {
  count = var.enable_cert_manager && var.letsencrypt_email != "" ? 1 : 0

  manifest = {
    apiVersion = "cert-manager.io/v1"
    kind       = "ClusterIssuer"
    metadata = {
      name = "letsencrypt-prod"
    }
    spec = {
      acme = {
        server = "https://acme-v02.api.letsencrypt.org/directory"
        email  = var.letsencrypt_email
        privateKeySecretRef = {
          name = "letsencrypt-prod"
        }
        solvers = [{
          http01 = {
            ingress = {
              class = "nginx"
            }
          }
        }]
      }
    }
  }

  depends_on = [helm_release.cert_manager]
}





resource "helm_release" "nginx_ingress" {
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  version          = "4.9.0"
  namespace        = "ingress-nginx"
  create_namespace = true

  set {
    name  = "controller.service.type"
    value = "NodePort"
  }

  set {
    name  = "controller.service.nodePorts.http"
    value = "30080"
  }

  set {
    name  = "controller.service.nodePorts.https"
    value = "30443"
  }

  set {
    name  = "controller.replicaCount"
    value = "2"
  }

  set {
    name  = "controller.metrics.enabled"
    value = var.enable_monitoring
  }

  set {
    name  = "controller.metrics.serviceMonitor.enabled"
    value = var.enable_monitoring
  }
}





resource "helm_release" "prometheus_stack" {
  count = var.enable_monitoring ? 1 : 0

  name             = "prometheus"
  repository       = "https://prometheus-community.github.io/helm-charts"
  chart            = "kube-prometheus-stack"
  version          = "56.0.0"
  namespace        = "monitoring"
  create_namespace = true

  values = [
    yamlencode({
      prometheus = {
        prometheusSpec = {
          retention = "30d"
          storageSpec = {
            volumeClaimTemplate = {
              spec = {
                storageClassName = "hcloud-volumes"
                accessModes      = ["ReadWriteOnce"]
                resources = {
                  requests = {
                    storage = "50Gi"
                  }
                }
              }
            }
          }
        }
      }
      grafana = {
        adminPassword = "admin"
        persistence = {
          enabled          = true
          storageClassName = "hcloud-volumes"
          size             = "10Gi"
        }
        datasources = {
          "datasources.yaml" = {
            apiVersion = 1
            datasources = [
              {
                name      = "Prometheus"
                type      = "prometheus"
                access    = "proxy"
                url       = "http://kube-prometheus-stack-prometheus.monitoring:9090"
                isDefault = true
                uid       = "prometheus"
              }
            ]
          }
        }
        ingress = {
          enabled = var.domain_name != ""
          hosts   = var.domain_name != "" ? ["grafana.${var.domain_name}"] : []
          annotations = var.domain_name != "" ? {
            "kubernetes.io/ingress.class"    = "nginx"
            "cert-manager.io/cluster-issuer" = "letsencrypt-prod"
          } : {}
        }
      }
      alertmanager = {
        alertmanagerSpec = {
          storage = {
            volumeClaimTemplate = {
              spec = {
                storageClassName = "hcloud-volumes"
                accessModes      = ["ReadWriteOnce"]
                resources = {
                  requests = {
                    storage = "10Gi"
                  }
                }
              }
            }
          }
        }
      }
    })
  ]
}





resource "helm_release" "loki" {
  count = var.enable_logging ? 1 : 0

  name             = "loki"
  repository       = "https://grafana.github.io/helm-charts"
  chart            = "loki-stack"
  version          = "2.10.0"
  namespace        = "logging"
  create_namespace = true

  set {
    name  = "promtail.enabled"
    value = "true"
  }

  set {
    name  = "loki.persistence.enabled"
    value = "true"
  }

  set {
    name  = "loki.persistence.storageClassName"
    value = "hcloud-volumes"
  }

  set {
    name  = "loki.persistence.size"
    value = "50Gi"
  }
}





resource "helm_release" "application" {
  name      = var.cluster_name
  chart     = var.app_chart_path
  namespace = kubernetes_namespace.main.metadata[0].name

  values = [
    yamlencode({
      global = {
        imageRegistry    = var.docker_registry
        imagePullSecrets = [for s in var.image_pull_secrets : s.name]
        storageClass     = "hcloud-volumes"
      }

      authApi = {
        image = {
          repository = "starlince/auth-api"
          tag        = "latest"
          pullPolicy = "Always"
        }
        replicaCount = var.environment == "production" ? 2 : 1
        pdb = {
          enabled      = var.environment == "production"
          minAvailable = 1
        }
        autoscaling = {
          enabled                        = var.environment == "production"
          minReplicas                    = 2
          maxReplicas                    = 5
          targetCPUUtilizationPercentage = 70
        }
        env = {
          NODE_ENV          = var.environment
          PORT              = "3001"
          POSTGRES_PASSWORD = var.postgresql_auth_password
        }
      }

      productApi = {
        image = {
          repository = "starlince/product-api"
          tag        = "latest"
          pullPolicy = "Always"
        }
        replicaCount = var.environment == "production" ? 2 : 1
        pdb = {
          enabled      = var.environment == "production"
          minAvailable = 1
        }
        autoscaling = {
          enabled                        = var.environment == "production"
          minReplicas                    = 2
          maxReplicas                    = 5
          targetCPUUtilizationPercentage = 70
        }
        env = {
          NODE_ENV          = var.environment
          PORT              = "3002"
          POSTGRES_PASSWORD = var.postgresql_product_password
        }
      }

      gateway = {
        image = {
          repository = "starlince/gateway"
          tag        = "latest"
          pullPolicy = "Always"
        }
        replicaCount = var.environment == "production" ? 2 : 1
      }

      ecommerce = {
        image = {
          repository = "starlince/ecommerce"
          tag        = "latest"
          pullPolicy = "Always"
        }
        replicaCount = var.environment == "production" ? 2 : 1
      }

      ingress = {
        enabled   = true
        className = "nginx"
        annotations = {
          "cert-manager.io/cluster-issuer" = var.enable_cert_manager ? "letsencrypt-prod" : ""
        }
        hosts = var.domain_name != "" ? [
          {
            host = "${var.subdomains.api}.${var.domain_name}"
            paths = [
              { path = "/", pathType = "Prefix", backend = "auth-api" }
            ]
          },
          {
            host = "${var.subdomains.gateway}.${var.domain_name}"
            paths = [
              { path = "/", pathType = "Prefix", backend = "gateway" }
            ]
          },
          {
            host = "${var.subdomains.app}.${var.domain_name}"
            paths = [
              { path = "/", pathType = "Prefix", backend = "ecommerce" }
            ]
          }
        ] : []
        tls = var.domain_name != "" && var.enable_cert_manager ? [
          {
            secretName = "${var.cluster_name}-tls"
            hosts = [
              "${var.subdomains.api}.${var.domain_name}",
              "${var.subdomains.gateway}.${var.domain_name}",
              "${var.subdomains.app}.${var.domain_name}"
            ]
          }
        ] : []
      }

      postgresql-auth = {
        enabled = var.postgresql_enabled
        auth = {
          postgresPassword = var.postgresql_auth_password
          database         = "auth"
        }
        primary = {
          persistence = {
            enabled      = true
            storageClass = "hcloud-volumes"
            size         = "20Gi"
          }
        }
      }

      postgresql-product = {
        enabled = var.postgresql_enabled
        auth = {
          postgresPassword = var.postgresql_product_password
          database         = "product"
        }
        primary = {
          persistence = {
            enabled      = true
            storageClass = "hcloud-volumes"
            size         = "20Gi"
          }
        }
      }
    })
  ]

  depends_on = [
    kubernetes_namespace.main,
    helm_release.nginx_ingress,
    helm_release.cert_manager
  ]
}
