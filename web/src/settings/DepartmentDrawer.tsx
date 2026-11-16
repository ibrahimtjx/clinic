import {
  Alert,
  Anchor,
  Badge,
  ColorSwatch,
  Group,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconDoor } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { usePrefs } from "../app/preferences";
import { AppDrawer } from "../components/AppDrawer";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import { nameOf } from "../master/queries";
import type { ColorName, Department } from "../master/types";

interface Overview {
  id: number;
  name_ar: string;
  name_en: string;
  doctors: {
    id: number;
    name_ar: string;
    name_en: string;
    specialty_ar: string;
    specialty_en: string;
    room: string;
    color: ColorName;
    is_active: boolean;
  }[];
  staff: {
    id: number;
    full_name_ar: string;
    full_name_en: string;
    roles_ar: string[];
    roles_en: string[];
    is_doctor: boolean;
  }[];
  patients:
    | {
        id: number;
        file_no: number;
        name_ar: string;
        name_en: string | null;
        visits: number;
        last_visit: string;
      }[]
    | null;
  patient_count: number | null;
  recent_days: number;
}

/** A department at a glance: its doctors (with rooms), staff, and the patients its doctors saw recently. */
export function DepartmentDrawer({
  department,
  onClose,
}: {
  department: Department | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const q = useQuery({
    queryKey: ["department-overview", department?.id],
    queryFn: () => api<Overview>(`/departments/${department!.id}/overview`),
    enabled: department !== null,
  });
  const o = q.data;
  const ar = lang === "ar";

  return (
    <AppDrawer
      opened={department !== null}
      onClose={onClose}
      title={nameOf(department, lang)}
      size="lg"
    >
      {q.isPending ? (
        <Stack>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={40} />
          ))}
        </Stack>
      ) : q.isError ? (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
          {errorMessage(t, q.error, lang)}
        </Alert>
      ) : (
        o && (
          <Stack gap="lg" data-testid="department-overview">
            <section>
              <Title order={4} mb="xs">
                {t("departments.doctors", { n: o.doctors.length })}
              </Title>
              {o.doctors.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {t("departments.noDoctors")}
                </Text>
              ) : (
                <Table>
                  <Table.Tbody>
                    {o.doctors.map((d) => (
                      <Table.Tr key={d.id} opacity={d.is_active ? 1 : 0.55}>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            <ColorSwatch
                              color={`var(--mantine-color-${d.color}-filled)`}
                              size={12}
                            />
                            <Text size="sm" fw={500}>
                              {nameOf(d, lang)}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {(ar ? d.specialty_ar : d.specialty_en) || ""}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {d.room ? (
                            <Badge
                              variant="light"
                              color="accent"
                              leftSection={<IconDoor size={12} />}
                              data-testid={`dept-room-${d.id}`}
                            >
                              {d.room}
                            </Badge>
                          ) : (
                            <Text size="sm" c="dimmed">
                              {t("departments.noRoom")}
                            </Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </section>

            <section>
              <Title order={4} mb="xs">
                {t("departments.staff", { n: o.staff.length })}
              </Title>
              {o.staff.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {t("departments.noStaff")}
                </Text>
              ) : (
                <Stack gap={6}>
                  {o.staff.map((s) => (
                    <Group key={s.id} justify="space-between">
                      <Text size="sm">
                        {ar ? s.full_name_ar : s.full_name_en || s.full_name_ar}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {(ar ? s.roles_ar : s.roles_en).join(ar ? "، " : ", ")}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </section>

            {o.patients && (
              <section>
                <Title order={4}>
                  {t("departments.patients", { n: o.patient_count ?? 0 })}
                </Title>
                <Text size="xs" c="dimmed" mb="xs">
                  {t("departments.patientsHint", { days: o.recent_days })}
                </Text>
                {o.patients.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    {t("departments.noPatients")}
                  </Text>
                ) : (
                  <Table striped>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t("patients.fileNo")}</Table.Th>
                        <Table.Th>{t("master.name")}</Table.Th>
                        <Table.Th>{t("departments.visits")}</Table.Th>
                        <Table.Th>{t("departments.lastVisit")}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {o.patients.map((p) => (
                        <Table.Tr key={p.id}>
                          <Table.Td dir="ltr">{p.file_no}</Table.Td>
                          <Table.Td>
                            <Anchor
                              component={Link}
                              to={`/patients/${p.id}`}
                              size="sm"
                            >
                              {ar ? p.name_ar : p.name_en || p.name_ar}
                            </Anchor>
                          </Table.Td>
                          <Table.Td>{p.visits}</Table.Td>
                          <Table.Td>
                            {formatDate(p.last_visit, lang, digits)}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </section>
            )}
          </Stack>
        )
      )}
    </AppDrawer>
  );
}
