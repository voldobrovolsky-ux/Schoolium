-- §5.1 Authz: права как данные — каталог прав + пакеты ролей (глобальная reference-data).

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePackage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "cabinet" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    CONSTRAINT "RolePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePackagePermission" (
    "rolePackageId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    CONSTRAINT "RolePackagePermission_pkey" PRIMARY KEY ("rolePackageId","permissionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RolePackage_key_key" ON "RolePackage"("key");

-- AddForeignKey
ALTER TABLE "RolePackagePermission" ADD CONSTRAINT "RolePackagePermission_rolePackageId_fkey" FOREIGN KEY ("rolePackageId") REFERENCES "RolePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePackagePermission" ADD CONSTRAINT "RolePackagePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
